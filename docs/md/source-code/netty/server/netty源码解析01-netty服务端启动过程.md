---
title: netty源码解析01-netty服务端启动过程
date: 2021-10-08 10:17:55
tags:
  - netty
  - java
categories:
  - java
  - netty
---

> 微信公众号：码农小谭，一个热爱coding、生活、分享、探讨的打工人，如果我的文章对你有帮助，麻烦给个关注吧~
>
> 公众号分享技术博文、生活百事、欢迎关注~
>
> 资料获取方式，无任何套路，也不需要解压验证码，如下：
>
> 需要java相关资料请回复【java】
>
> 需要数据库相关资料请回复【数据库】
>
> 需要计算机网络相关资料请回复【计算机网络】
>
> 需要操作系统相关资料请回复【操作系统】
>
> 需要算法相关资料请回复【算法】
>
> 如果资料链接失效，请点击联系作者添加微信，第一时间会进行更新。

![](https://img.zeroable.cn/202204081144544.png)

> 提示:如果没有听过或者使用过java nio 和netty，不建议直接阅读此文章，建议先去了解java nio 和netty之后再阅读此文章。

<!--more-->

# netty 服务端启动

我们知道，netty是对java nio 的进一步的封装和优化，所以，在netty中，肯定有几行代码，创建了java  nio，所以，我们在了解netty服务端启动之前，肯定需要知道以下俩个问题：

1. java nio 的socket是在哪里进行初始化的呢？
2. 在哪里进行accept连接？

## 创建服务端Channel

那么我们带着这俩个问题，进行阅读源码。为了防止你阅读此文章时过于迷茫，我先将大致的过程先写出来：

1. 创建服务端Channel。
  	1. `bind()`用户代码入口。
  	2. `initAndRegister()`初始化并注册
  	3. `newChannel()` 创建`java`服务端`Channel`。
2. 初始化服务端`Channel`。
3. 注册`selector`。
4. 绑定端口。

首先我们先写一个简单的netty Server demo，如下：

```java
NioEventLoopGroup bossGroup = new NioEventLoopGroup();
NioEventLoopGroup workGroup = new NioEventLoopGroup();
try {
    ServerBootstrap serverBootstrap = new ServerBootstrap();
    serverBootstrap.group(bossGroup, workGroup)
        .channel(NioServerSocketChannel.class)
        .childOption(ChannelOption.TCP_NODELAY, true)
        .childAttr(AttributeKey.newInstance("childAttr"), "childAttr")
        .handler(new ServerHandler())
        .childHandler(new ChannelInitializer() {
            @Override
            protected void initChannel(Channel ch) throws Exception {
                //ch.pipeline().addLast();
            }
        });
    ChannelFuture f = serverBootstrap.bind(9999).sync();
    f.channel().closeFuture().sync();
} catch (InterruptedException e) {
    e.printStackTrace();
} finally {
    bossGroup.shutdownGracefully();
    workGroup.shutdownGracefully();
}
```

### 用户代码入口

我们首先从第16行代码的`bind()` 方法进行查看源码。跟进去发现，最后是调用了`doBind(localAddress)`方法，如下：

```java
public ChannelFuture bind(SocketAddress localAddress) {
    validate();
    if (localAddress == null) {
    	throw new NullPointerException("localAddress");
    }
    //实际上是这个方法在做事情。
    return doBind(localAddress);
}
```

继续去查看`doBind(localAddress)` 方法，发现他的实现如下：

```java
private ChannelFuture doBind(final SocketAddress localAddress) {
	//1. 初始化并且注册，这一步就是创建一个java nio channel,
	//并且将之绑定到ChannelFuture，它是对Channel 的进一步封装。
    final ChannelFuture regFuture = initAndRegister();
    final Channel channel = regFuture.channel();
    if (regFuture.cause() != null) {
    	return regFuture;
    }
	
	//下面的暂时不用管暂时就删掉了，不然看的好麻烦
    //dosomething...
    }
}
```

### 初始化并注册

我们跟进`initAndRegister()`方法中，发现内容如下：

```java
final ChannelFuture initAndRegister() {
    Channel channel = null;
    try {
        // 这里非常重要
        channel = channelFactory.newChannel();
        //这里就是初始化channel，这里后面再讲。
        init(channel);
    } catch (Throwable t) {
        if (channel != null) {
            // channel can be null if newChannel crashed (eg SocketException("too many open files"))
            channel.unsafe().closeForcibly();
        }
        // as the Channel is not registered yet we need to force the usage of the GlobalEventExecutor
        return new DefaultChannelPromise(channel, GlobalEventExecutor.INSTANCE).setFailure(t);
    }
    //dosomething...
}
```

### 创建java服务端Channel

我们继续通过第5行代码`channelFactory.newChannel();` 继续跟进去，发现她其实就是通过反射进行创建了一个对象：

```java
@Override
public T newChannel() {
    try {
    	return clazz.newInstance();
    } catch (Throwable t) {
    	throw new ChannelException("Unable to create Channel from class " + clazz, t);
    }
}
```

那么我们需要知道这个`clazz` 变量是哪个class对象，那就需要知道channelFactory是在哪里进行初始化的，我们直接回到demo代码中第6行：`channel(NioServerSocketChannel.class)` 跟踪这个方法发现：

```java
    public B channel(Class<? extends C> channelClass) {
        if (channelClass == null) {
            throw new NullPointerException("channelClass");
        }
        // 使用的是ReflectiveChannelFactory 类,clazz也就是我们demo 中传入的 NioServerSocketChannel.class 对象，中间还省略了一个重载方法，忽略。
        return channelFactory(new ReflectiveChannelFactory<C>(channelClass));
    }

    /**
     * @deprecated Use {@link #channelFactory(io.netty.channel.ChannelFactory)} instead.
     */
    @Deprecated
    @SuppressWarnings("unchecked")
    public B channelFactory(ChannelFactory<? extends C> channelFactory) {
        if (channelFactory == null) {
            throw new NullPointerException("channelFactory");
        }
        if (this.channelFactory != null) {
            throw new IllegalStateException("channelFactory set already");
        }
		//这里就对channelFactory 变量进行赋值。
        this.channelFactory = channelFactory;
        return (B) this;
    }
```

那么我们只需要关注NioServerSocketChannel类的构造函数做了哪些事情。我还是提前告诉你构造函数做了什么事情：

1. `newSocket()` 通过jdk来创建底层jdk channel。之前的俩个问题中的第一个问题就在这里进行了解决。
2. `NIOServerSocketChannelConfig()` tcp参数配置类，比如backlog、recv buffer、send buffer等跟tcp参数相关的配置。
3. `AbstractNioChannel()` 父类构造函数，调用 `ch.configureBlocking(false);` 设置阻塞模式为非阻塞。
4. `AbstractChannel` 父类构造函数。创建此channel的id、unsafe、pipeline。

#### 创建底层jdk channel

我们一步步来通过源码来看看这5步具体怎么实现的。首先我们看看`newSocket()` 做了什么事情，首先把NioServerSocketChannel的构造方法内容贴出来：



```java
private static final SelectorProvider DEFAULT_SELECTOR_PROVIDER = SelectorProvider.provider();
	/**
     * Create a new instance
     */
    public NioServerSocketChannel() {
        //这里是第一步,newSocket通过SelectorProvider创建了jdk底层的ServerSocketChannel，
        //而这个provider就是SelectorProvider.provider();
        this(newSocket(DEFAULT_SELECTOR_PROVIDER));
    }

    private static ServerSocketChannel newSocket(SelectorProvider provider) {
        try {
            /**
             *  Use the {@link SelectorProvider} to open {@link SocketChannel} and so remove condition in
             *  {@link SelectorProvider#provider()} which is called by each ServerSocketChannel.open() otherwise.
             *
             *  See <a href="https://github.com/netty/netty/issues/2308">#2308</a>.
             */
            return provider.openServerSocketChannel();
        } catch (IOException e) {
            throw new ChannelException(
                    "Failed to open a server socket.", e);
        }
    }

    /**
     * Create a new instance using the given {@link ServerSocketChannel}.
     */
    public NioServerSocketChannel(ServerSocketChannel channel) {
        super(null, channel, SelectionKey.OP_ACCEPT);
        //这里进行了第二步，创建了一个配置类。这个config的主要目的在后续对这个channel做一些tcp参数的获取，在set操作的时候，就通过这个config 去配置
        config = new NioServerSocketChannelConfig(this, javaChannel().socket());
    }
```

我们再通过上面代码的第30行，调用父类构造方法，一直跟进到`AbstractNioChannel`类的构造方法：

```java
    protected AbstractNioChannel(Channel parent, SelectableChannel ch, int readInterestOp) {
        //这里是第三步，这里是父类的构造方法，生成channel的id、unsafe、pipeline 属性。
        super(parent);
        this.ch = ch;
        this.readInterestOp = readInterestOp;
        try {
            //这里是第四步，这里设置channel 的阻塞模式为非阻塞模式。
            ch.configureBlocking(false);
        } catch (IOException e) {
            try {
                ch.close();
            } catch (IOException e2) {
                if (logger.isWarnEnabled()) {
                    logger.warn(
                            "Failed to close a partially initialized socket.", e2);
                }
            }
            throw new ChannelException("Failed to enter non-blocking mode.", e);
        }
    }
```

最后一步，生成`channel` 的`id` 、 `unsafe`、`pipline`。

```java
protected AbstractChannel(Channel parent) {
    this.parent = parent;
    id = newId();
    unsafe = newUnsafe();
    pipeline = newChannelPipeline();
}
```

## 初始化Channel

还记得之前的那个`initAndRegister()`方法中的`init()` 吗？不记得可以去看看在哪里哦，那`init()` 做了哪些事情呢？我还是提前告诉你，好让你的提前知道，没有那么迷茫。

1. 设置ChannelOptions 、ChannelAttrs。
2. 设置childOptions、childAttrs。每次accept一个新连接，就会用户自定义的这俩个属性配置上去。
3. `config handler` 配置服务端pipline。这个的逻辑链也会是在用户代码里面的handler方法进行设置。
4. add ServerBootstrapAcceptor 添加连接器。服务端的pipline都会有一个ServerBootstrapAcceptor这个特殊的处理器。这个处理器主要用于给accept一个新连接分配一个nio的线程。

我们开始从`init(channel)` 入手，发现这个是一个abstract 方法，有俩个子类，我们分析的服务端，我们选择ServerBootstrap类，内容如下：

```java
    @Override
    void init(Channel channel) throws Exception {
        //第一步，设置ChannelOptions、ChannelAttrs。首先获取options
        final Map<ChannelOption<?>, Object> options = options0();
        synchronized (options) {
            //设置Options,这里的config就是我们前面说过的NioServerSocketChannelConfig
            channel.config().setOptions(options);
        }
		//这里进行ChannelAttrs属性的设置。用于绑定用户自定义的一些channel属性。
        final Map<AttributeKey<?>, Object> attrs = attrs0();
        synchronized (attrs) {
            //循环绑定到channel的attrs中。
            for (Entry<AttributeKey<?>, Object> e: attrs.entrySet()) {
                @SuppressWarnings("unchecked")
                AttributeKey<Object> key = (AttributeKey<Object>) e.getKey();
                channel.attr(key).set(e.getValue());
            }
        }

        ChannelPipeline p = channel.pipeline();
		//下面会用到，这就是用户自定义的childGroup
        final EventLoopGroup currentChildGroup = childGroup;
        //下面会用到，这就是用户自定义的childHandler
        final ChannelHandler currentChildHandler = childHandler;
        final Entry<ChannelOption<?>, Object>[] currentChildOptions;
        final Entry<AttributeKey<?>, Object>[] currentChildAttrs;
        //这里是保存了childOptions 和childAttrs。和上面保存ChannelOptions、ChannelAttrs差不多，这是比较简单的。
        synchronized (childOptions) {
            currentChildOptions = childOptions.entrySet().toArray(newOptionArray(childOptions.size()));
        }
        synchronized (childAttrs) {
            currentChildAttrs = childAttrs.entrySet().toArray(newAttrArray(childAttrs.size()));
        }
		//配置服务端pipline。
        p.addLast(new ChannelInitializer<Channel>() {
            @Override
            public void initChannel(Channel ch) throws Exception {
                //这里拿到pipline ，然后将用户添加的handler添加到pipline链上。
                final ChannelPipeline pipeline = ch.pipeline();
                //这里我们分析一下config.handler(); 的handler是在哪里设置的。
                ChannelHandler handler = config.handler();
                if (handler != null) {
                    pipeline.addLast(handler);
                }

                // We add this handler via the EventLoop as the user may have used a ChannelInitializer as handler.
                // In this case the initChannel(...) method will only be called after this method returns. Because
                // of this we need to ensure we add our handler in a delayed fashion so all the users handler are
                // placed in front of the ServerBootstrapAcceptor.
                ch.eventLoop().execute(new Runnable() {
                    @Override
                    public void run() {
                        //将用户自定义的childGroup、childHandler、ChildOptions、ChildAttrs放入这个特殊的handler中，这个特殊的handler主要是用于处理新连接的。
                        pipeline.addLast(new ServerBootstrapAcceptor(
                                currentChildGroup, currentChildHandler, currentChildOptions, currentChildAttrs));
                    }
                });
            }
        });
    }
```

我们在分析之前，我们先来看看这个demo中的第9行代码`.handler(new ServerHandler())` 看看handler方法中做了什么事情。其实非常简单，就是对变量的赋值，保存我们用户的自定义handler。代码就不贴出来了，自己点进去看下吧。然后我们回到`init`方法，其实也就是拿到保存的handler变量。拿到之后就将用户自定义的handler 添加到pipline中。

那么到了我们最后一个过程，添加一个`ServerBootstrapAcceptor` 其实他是一个特殊的handler。这里就不详细去介绍这个handler了，后面会进行详细讲解。

## 注册Selector

当创建和初始化完成之后，接下来就是将这个channel注册到事件轮询器Selector上去。让我们一起来看看他的一个注册的过程吧。首先我们从`initAndRegister()` 开始查看，发现他有如下一段代码：

```java
final ChannelFuture initAndRegister() {
    Channel channel = null;
    try {
        channel = channelFactory.newChannel();
        init(channel);
    } catch (Throwable t) {
        if (channel != null) {
            // channel can be null if newChannel crashed (eg SocketException("too many open files"))
            channel.unsafe().closeForcibly();
        }
        // as the Channel is not registered yet we need to force the usage of the GlobalEventExecutor
        return new DefaultChannelPromise(channel, GlobalEventExecutor.INSTANCE).setFailure(t);
    }
	// 注册到Selector就在这个方法中。
    ChannelFuture regFuture = config().group().register(channel);
    if (regFuture.cause() != null) {
        if (channel.isRegistered()) {
            channel.close();
        } else {
            channel.unsafe().closeForcibly();
        }
    }

    // If we are here and the promise is not failed, it's one of the following cases:
    // 1) If we attempted registration from the event loop, the registration has been completed at this point.
    //    i.e. It's safe to attempt bind() or connect() now because the channel has been registered.
    // 2) If we attempted registration from the other thread, the registration request has been successfully
    //    added to the event loop's task queue for later execution.
    //    i.e. It's safe to attempt bind() or connect() now:
    //         because bind() or connect() will be executed *after* the scheduled registration task is executed
    //         because register(), bind(), and connect() are all bound to the same thread.

    return regFuture;
}
```

上面代码的：`ChannelFuture regFuture = config().group().register(channel);` 这里就进行了注册。让我们查看这个注册Selector过程，netty一共做了多少事情吧，大致的流程如下：

1. 最终是调用了`AbstractChannel.register(channel);`方法，这是入口。(**这里比较绕，需要知道EventLoopGroup和EventLoop之间的关系和创建流程，这个并不是这篇文章的重点，所以暂时忽略掉，先告诉你结论。大概的流程就是：这里`AbstractChannel`的最终子类就是一个EventLoop也就是在EventLoopGroup创建的时候根据传入的线程数创建对应的EventLoop实例，通过一个数组进行保存，然后通过一个chooser根据下标进行选择对用的EventLoop进行执行，后面文章会详细讲解EventLoopGroup和EventLoop，先不需要知道详细的过程。**)
2. 调用`this.eventLoop = eventLoop`; 用来绑定NIO线程，也就是eventLoop。
3. 调用`register0();`这个是实际的注册。
   1. 调用`doRegister();`进行jdk底层注册。
   2. 调用`invokeHandlerAddedIfNeeded();`做一些事件的回调，比如我们开发者在添加一些handler到netty的channel上时，在这个过程，就会触发到我们的用户的回调。
   3. 调用`fireChannelRegistered()` 进行事件传播。将channel注册成功的事件传播到用户的代码中。

那我们现在回到`AbstractChannel`中的`register` 方法中。代码如下：

```java
//AbstractChannel.java
@Override
public final void register(EventLoop eventLoop, final ChannelPromise promise) {    
    if (isRegistered()) {
        promise.setFailure(new IllegalStateException("registered to an event loop already"));
        return;
    }
    if (!isCompatible(eventLoop)) {
        promise.setFailure(
            new IllegalStateException("incompatible event loop type: " + eventLoop.getClass().getName()));
        return;
    }
	//这里就进行eventLoop的绑定。
    AbstractChannel.this.eventLoop = eventLoop;

    //执行register0();
    //这里是判断执行当前方法的线程是否为当前的这个eventLoop中的线程，如果是，那么就直接执行，否则就使用eventLoop中的线程去执行
    if (eventLoop.inEventLoop()) {
        register0(promise);
    } else {
        try {
            eventLoop.execute(new Runnable() {
                @Override
                public void run() {
                    register0(promise);
                }
            });
        } catch (Throwable t) {
            logger.warn(
                "Force-closing a channel whose registration task was not accepted by an event loop: {}",
                AbstractChannel.this, t);
            closeForcibly();
            closeFuture.setClosed();
            safeSetFailure(promise, t);
        }
    }
}
```

正如代码中的注释，最后是通过调用`register0();`方法进行注册。但是我们可以看到，注册前netty对当前线程进行了判断，判断当前线程是不是一个eventLoop线程，我们查看`eventLoop.inEventLoop()` 方法发现，就是将当前线程实体作为参数传给一个重写方法，即：`inEventLoop(Thread.currentThread());` 然后再进去发现，只有一行代码，就是`return thread == this.thread;` 其中`this.thread` 就是eventLoop中的线程。了解了这个之后，我们再来查看`register0();` 到底干了些啥？流程如下：

1. 调用`doRegister();`进行真正的调用。
2. 调用`pipeline.invokeHandlerAddedIfNeeded();` 进行通知，也就是会去执行我们用户代码中handler实例的`handlerAdded(ChannelHandlerContext ctx);`方法。
3. 调用`pipeline.fireChannelRegistered();`进行通知，也就是会去执行我们用户代码里面的handler实例的`channelRegistered(ChannelHandlerContext ctx);`方法。

pipeline后续文章会继续讲解，这里忽略，只需要知道这里进行了通知就行，然后我们查看`doRegister();`方法，这个方法具体实现在`AbstractNioChannel`类中，代码如下：

```java
@Override
protected void doRegister() throws Exception {
    boolean selected = false;
    for (;;) {
        try {
            selectionKey = javaChannel().register(eventLoop().selector, 0, this);
            return;
        } catch (CancelledKeyException e) {
            if (!selected) {
                // Force the Selector to select now as the "canceled" SelectionKey may still be
                // cached and not removed because no Select.select(..) operation was called yet.
                eventLoop().selectNow();
                selected = true;
            } else {
                // We forced a select operation on the selector before but the SelectionKey is still cached
                // for whatever reason. JDK bug ?
                throw e;
            }
        }
    }
}
```

其实就是在这里，进行了jdk底层的nio的注册，并且将当前的这个channel作为一个`attachment`绑定到jdk底层的channel中，方便后续获取。到这里，就已经注册好jdk的nio的channel，并且将netty的channel注册到jdk nio 的channel上。

## 绑定端口

接下来就是进行端口的绑定，回到我们调用`initAndRegister()`的地方，也就是`AbstractBootStrap.doBind();`方法。不难发现，最终是调用`doBind0();`进行最终的绑定。而`doBind0();`也是调用`channel.bind(localAddress, promise).addListener(ChannelFutureListener.CLOSE_ON_FAILURE);`。然后层层跟进，发现他是通过pipeline进行绑定，最终还是到达`AbstractChannel.AbstractUnsafe`类的`bind();`，这里做了俩件事情：

1. 先获取`isActive();`
2. 调用`doBind();`方法。
3. 当只有执行`doBind();`方法前isActive是false,执行之后是true,才会去进行通知，触发用户代码中handler的`channelActive(ctx);`。

```java
@Override
public final void bind(final SocketAddress localAddress, final ChannelPromise promise) {
    assertEventLoop();

    if (!promise.setUncancellable() || !ensureOpen(promise)) {
        return;
    }

    // See: https://github.com/netty/netty/issues/576
    if (Boolean.TRUE.equals(config().getOption(ChannelOption.SO_BROADCAST)) &&
        localAddress instanceof InetSocketAddress &&
        !((InetSocketAddress) localAddress).getAddress().isAnyLocalAddress() &&
        !PlatformDependent.isWindows() && !PlatformDependent.isRoot()) {
        // Warn a user about the fact that a non-root user can't receive a
        // broadcast packet on *nix if the socket is bound on non-wildcard address.
        logger.warn(
            "A non-root user can't receive a broadcast packet if the socket " +
            "is not bound to a wildcard address; binding to a non-wildcard " +
            "address (" + localAddress + ") anyway as requested.");
    }
	//在调用doBind方法前获取isActive。
    boolean wasActive = isActive();
    try {
        doBind(localAddress);
    } catch (Throwable t) {
        safeSetFailure(promise, t);
        closeIfClosed();
        return;
    }
	//当只有执行`doBind();`方法前isActive是false,执行之后是true,才会去进行通知，触发用户代码中handler的`channelActive(ctx);`。
    if (!wasActive && isActive()) {
        invokeLater(new Runnable() {
            @Override
            public void run() {
                pipeline.fireChannelActive();
            }
        });
    }

    safeSetSuccess(promise);
}
```

然后调用`doBind();`方法，这个方法是一个抽象方法，实现是在他的子类中，所以，最终绑定发生在`NioServerSocketChannel`类的`bind();`方法。这里比较绕，建议多看几次。最后绑定端口，代码很简单，就是通过jdk底层的channel进行端口的绑定。代码如下：

```java
NioServerSocketChannel.java
@Override
protected void doBind(SocketAddress localAddress) throws Exception {
    if (PlatformDependent.javaVersion() >= 7) {
        javaChannel().bind(localAddress, config.getBacklog());
    } else {
        javaChannel().socket().bind(localAddress, config.getBacklog());
    }
}
```

其中这个事件传播是从pipeline进行传播，我们来看看这个pipeline做了哪些事情。我们跟进去发现，他触发了pipeline中的一个head的`invokeChannelActive();`方法。而这个方法最终调用的就是`DefaultChannelPipeline`的`HeadContext`子类的`channelActive(ctx);`方法，代码如下：

```java
@Override
public void channelActive(ChannelHandlerContext ctx) throws Exception {
    ctx.fireChannelActive();

    readIfIsAutoRead();
}
```

通过这个`ctx.fireChannelActive();`方法调用用户代码中的自定义handler的`channelActive(ctx);`方法，然后调用了一个`readIfIsAutoRead();`这个方法会触发`channel.read();`事件。最终会从pipeline开始传播，我们来看看到底这个read，做了什么事情。他传播到了pipeline的一个tail的一个read方法。这个tail是pipeline中的一个默认的节点，它是最尾部的一个节点。事件传播后续文章会继续详细讲解，最终会调用到`AbstractChannel.AbstractUnSafe`类的`beginRead();` 然后调用一个`doBeginRead();`方法。我们进去看看这个方法做了什么事情。最终在`AbstractNioChannel`中的`doBeginRead();`方法。代码如下：

```java
@Override
protected void doBeginRead() throws Exception {
    // Channel.read() or ChannelHandlerContext.read() was called
    final SelectionKey selectionKey = this.selectionKey;
    if (!selectionKey.isValid()) {
        return;
    }

    readPending = true;

    final int interestOps = selectionKey.interestOps();
    if ((interestOps & readInterestOp) == 0) {
        selectionKey.interestOps(interestOps | readInterestOp);
    }
}
```

看到这里，如果对jdk nio熟悉的同学，应该就比较明白了。首先我们先拿到selectionKey，这个就是我们之前代码中讲到注册服务端channel到selector上去的时候返回的一个selectionKey。然后拿到这个selectionKey的一个事件。还还记得我们填写的事件是啥吗？是一个0，忘记的可以看看前面的代码。那么interestOps的结果是0。那么这个条件成立。`selectionKey.interestOps(interestOps | readInterestOp);`其实就是一个新的readInterestOp事件重新添加到selectionKey中的呢？那么这个readInterestOp到底代表的是什么事件呢？如果你还有印象，那么就会知道，这个readInterestOp其实就是一个accept事件。（在NioServerSocketChannel的构造函数时，调用父类构造函数，传入的就是一个SelectionKey.OP_ACCEPT）。

## 总结

通过上述步骤，我们一步步对源码进行分析，我们知道了这个netty服务端是怎么启动的。如果你还对netty服务端的启动不是很清楚，建议结合本篇文章，自己去多看看netty的源码，好好的梳理一下~

![](https://img.zeroable.cn/202204081144544.png)

