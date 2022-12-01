---
title: netty源码解析03-新连接的处理以及添加读事件的添加
date: 2021-11-10 10:17:55
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

# 新连接的处理

## 前言

上一篇文章，我们知道了NioEventLoop是做什么的，也了解到了NioEventLoop从创建，到启动，然后到执行任务的一些具体的流程。也能看出来，netty对一些细微的东西都进行了优化，比如之前的NioEventLoop的选择器chooser的创建，根据创建的线程数量是否是2的幂次，创建俩种不同的chooser，如果是，那么创建一种直接通过位运算来选择哪一个NioEventLoop。否则就取余来选择。还有他对SelectKyeSet的优化，将原来的add方法的最慢时间复杂度从O(n)提升到了O(1)，而且是比较稳定的。然后就是通过一个巧妙的方法解决了JDK NIO 在某些情况下的空轮询的bug，具体的可以去查看我的上一篇文章，这里就不做过多的赘述了。

我们之前的俩篇文章都是在介绍netty的东西，比较少的接触到JDK 底层的NIO 代码。通过这篇文章，我们就能就知道，netty是怎么获取新连接的，以及对新连接的处理。

## 服务端流程的回顾

通过前面文章的分析，我们知道，服务端NioEventLoop线程启动，发生在`AbstractBootstrap.doBind0();`方法中，通过往NioEventLoop中添加一个task任务来启动线程。但是对应的selector对任何事件都不感兴趣，也就是`readInterestOp`为0。绑定端口成功后，才通过`pipeline.fireChannelActive();`把NioServerSocketChannel上的`SelectionKey.OP_ACCEPT`也就是16 重新添加到selectionKey上。那我们来仔细分析这个怎么重新添加新的`SelectionKey`的。

### 初次注册SelectionKey

如果你看过之前的文章，那么这个你应该会知道，这个注册发生在netty调用JDK Nio底层的注册，并且将netty的NioServerSocketChannel当做一个att绑定到jdk 的channel上。我们再次复习一下把~

![image-20211112104435984](https://gitee.com/zeroable/ima/raw/master/img/image-20211112104435984.png)

通过上面的流程可以发现，通过`selectionKey = javaChannel().register(eventLoop().selector, 0, this);`这里的参数0就是最开始的interestOps。

### 重新绑定SelectionKey

然后等待到端口绑定完成后，netty会是用`pipeline.fireChannelActive();`对完成事件进行传播，如下图：

![image-20211112110724253](https://gitee.com/zeroable/ima/raw/master/img/image-20211112110724253.png)

pipeline有head和tail节点，事件的传播都是从head节点开始传播，点进fireChannelActive中，我们可以看到：

```java
//DefaultChannelPipeline.java
@Override
public final ChannelPipeline fireChannelActive() {
    // 这里就是从head节点开始传播，我们继续查看invokeChannelActive方法
    AbstractChannelHandlerContext.invokeChannelActive(head);
    return this;
}
static void invokeChannelActive(final AbstractChannelHandlerContext next) {
    EventExecutor executor = next.executor();
    if (executor.inEventLoop()) {
        // 继续跟踪这个invokeChannelActive.
        next.invokeChannelActive();
    } else {
        executor.execute(new Runnable() {
            @Override
            public void run() {
                next.invokeChannelActive();
            }
        });
    }
}
//DefaultChannelPipeline.HeadContext.java
@Override
public void channelActive(ChannelHandlerContext ctx) throws Exception {
    ctx.fireChannelActive();

    readIfIsAutoRead();
}
private void readIfIsAutoRead() {
    if (channel.config().isAutoRead()) {
        // 这里触发了channel的read方法，我们知道，这个channel指的是NioServerSocketChannel.
        // 这里又调用了pipeline的read方法，不过这个read方法，是直接是用尾节点tail。
        // 最终还是通过unsafe的beginRead进行操作。
        // 这里为啥这么绕呢，看着人真头疼，其实可以类比我们平时坐的公交车，起点站到终点站的路线并不是直线，也不是最短的。
        // 这是因为要兼顾旁边的地区，不然会导致有的地方又公交车站，有的地方没有公交车站，虽然绕了，但是给人们出行提供了便利。
        // 这也就是为啥netty是用一个pipeline，还要在pipeline中添加head和tail俩个节点，这样就可以覆盖范围更大一点。
        channel.read();
    }
}
// AbstractChannel.AbstractUnsafe.java
@Override
public final void beginRead() {
    assertEventLoop();

    if (!isActive()) {
        return;
    }

    try {
        doBeginRead();
    } catch (final Exception e) {
        invokeLater(new Runnable() {
            @Override
            public void run() {
                pipeline.fireExceptionCaught(e);
            }
        });
        close(voidPromise());
    }
}
// AbstractNioChannel.java
@Override
protected void doBeginRead() throws Exception {
    // Channel.read() or ChannelHandlerContext.read() was called
    // 这个selectionKey就是在NioServerSocketChannel的构造方法中，传入的一个SelectionKey.OP_ACCEPT,也就是16。
    // super(null, channel, SelectionKey.OP_ACCEPT);
    
    final SelectionKey selectionKey = this.selectionKey;
    if (!selectionKey.isValid()) {
        return;
    }

    readPending = true;
	//直到这里，才开始正真监听连接事件。
    final int interestOps = selectionKey.interestOps();
    if ((interestOps & readInterestOp) == 0) {
        selectionKey.interestOps(interestOps | readInterestOp);
    }
}
```

## 新连接的处理

重新绑定了事件后，才开始监听连接事件。

### 新连接的检测

我们知道服务端的线程在绑定端口前就启动了，这个线程就是轮询进行获取事件，其中就包括新连接事件。还记得上一篇文章分析NioEventLoop时讲到的`select();`方法吗？通过这个方法，调用JDK NIO 底层的`select();`方法，获取网络IO。然后通过`processSelectedKeys();`来处理IO事件。这里netty对原来的SelectKeySet进行了优化，然后遍历这个集合，查找对应的事件：

![image-20211112141559714](https://gitee.com/zeroable/ima/raw/master/img/image-20211112141559714.png)

### 新连接的处理

这里触发了`unsafe.read();`事件。如下：

![image-20211112142257571](https://gitee.com/zeroable/ima/raw/master/img/image-20211112142257571.png)

我们看看`doReadMessages();`做了些啥：

```java
//NioServerSocketChannel.java
@Override
protected int doReadMessages(List<Object> buf) throws Exception {
    SocketChannel ch = javaChannel().accept();

    try {
        if (ch != null) {
            // 这里将新连接封装成一个NIOSocketChannel,加入buf集合中。
            buf.add(new NioSocketChannel(this, ch));
            return 1;
        }
    } catch (Throwable t) {
        logger.warn("Failed to create a new channel from an accepted socket.", t);

        try {
            ch.close();
        } catch (Throwable t2) {
            logger.warn("Failed to close a socket.", t2);
        }
    }

    return 0;
}
```

上面的while条件中的`allocHandle.incMessagesRead();`代码如下:

```java
@Override
public boolean continueReading() {
    return config.isAutoRead() &&
        attemptedBytesRead == lastBytesRead &&
        totalMessages < maxMessagePerRead &&
        totalBytesRead < Integer.MAX_VALUE;
}
```

我们继续查看下面的代码：

```java
int size = readBuf.size();
for (int i = 0; i < size; i ++) {
    readPending = false;
    // 这里通过pipeline进行传播read事件，这里也就是新连接事件。
    pipeline.fireChannelRead(readBuf.get(i));
}
```

### 新连接的注册

还记得我们在ServerBootstrap的`dobind()`方法中的`initAndRegister()`吗？里面的`init(channel)`中，我们再次复习一下：

```java
@Override
void init(Channel channel) throws Exception {
    // 。。。 非重要代码省略。。。。
    ChannelPipeline p = channel.pipeline();
    p.addLast(new ChannelInitializer<Channel>() {
        @Override
        public void initChannel(Channel ch) throws Exception {
            final ChannelPipeline pipeline = ch.pipeline();
            ChannelHandler handler = config.handler();
            if (handler != null) {
                pipeline.addLast(handler);
            }

            // We add this handler via the EventLoop as the user may have used a ChannelInitializer as handler.
            // In this case the initChannel(...) method will only be called after this method returns. Because
            // of this we need to ensure we add our handler in a delayed fashion so all the users handler are
            // placed in front of the ServerBootstrapAcceptor.
            
            // 我们通过EventLoop添加此处理程序，因为用户可能使用了ChannelInitializer作为处理程序。
			// 在这种情况下，只有在该方法返回后才会调用initChannel（…）方法。
            // 因此，我们需要确保以延迟方式添加处理程序，以便所有用户处理程序都放在ServerBootstrapAcceptor前面。
            ch.eventLoop().execute(new Runnable() {
                @Override
                public void run() {
                    // 这里就是将一个handler添加到pipeline的tail节点之前。
                    // 这个ServerBootstrapAcceptor就是处理新连接事件的，我们可以点进去查看一下。
                    pipeline.addLast(new ServerBootstrapAcceptor(
                        currentChildGroup, currentChildHandler, currentChildOptions, currentChildAttrs));
                }
            });
        }
    });
}
```

从上面的就可以看出来，其实在初始化channel的时候，netty就将处理新连接事件的handler添加到pipeline中了，等到新连接接入时，就可以调用`pipeline.fireChannelRead();`从head节点依次往下进行传播，直到传播到`ServerBootstrapAcceptor`这里，我们看看这个`ServerBootstrapAcceptor.channelRead();`做了哪些事情吧：

```java
@Override
@SuppressWarnings("unchecked")
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    final Channel child = (Channel) msg;
	// 将childHandler绑定到子Channel的pipeline中的节点上。
    child.pipeline().addLast(childHandler);
	// 然后循环把一些客户端的属性添加到配置中。
    for (Entry<ChannelOption<?>, Object> e: childOptions) {
        try {
            if (!child.config().setOption((ChannelOption<Object>) e.getKey(), e.getValue())) {
                logger.warn("Unknown channel option: " + e);
            }
        } catch (Throwable t) {
            logger.warn("Failed to set a channel option: " + child, t);
        }
    }
	
    for (Entry<AttributeKey<?>, Object> e: childAttrs) {
        child.attr((AttributeKey<Object>) e.getKey()).set(e.getValue());
    }

    try {
        // 这里就调用work那个NioEventLoopGroup中选择一个NioEventLoop进行注册。
        // 那么这个新连接的读事件都是通过这个NioEventLoop进行操作。
        // 到这里就完成新连接的检测和处理。
        childGroup.register(child).addListener(new ChannelFutureListener() {
            @Override
            public void operationComplete(ChannelFuture future) throws Exception {
                if (!future.isSuccess()) {
                    forceClose(child, future.cause());
                }
            }
        });
    } catch (Throwable t) {
        forceClose(child, t);
    }
}
```

我们继续跟进`childGroup.register();` 那我们应该知道，这里的register在`NioEventLoopGroup`中，其实就是在这个group中选择选择一个`NioEventLoop`进行注册，也就是调用了`next().register();`这个我们之前都说过了，那么我们就不再重复的粘贴代码了，最终也是到了`channel`的`unSafe.register();`方法，这里的`channel` 就不是我们之前说过的`NIoServerSocketChannel`了,而是`NioSocketChannel`,所以们去这个类下的`unsafe`类，这个`register`在父类`AbstractUnsafe`中。

### 新连接重新绑定SelectionKey

然而在这个方法中，最终调用的是`doRegister();`也就是通过`selectionKey = javaChannel().register(eventLoop().selector, 0, this);`将新的连接的`JDK` 底层的`channel`绑定到`selector`上，并将这个`netty`的`NioSocketChannel`对象作为一个`attachment`也绑定到`selector`上。注意此时绑定的`interestOps`还是0，并未将读事件绑定到`selector`上。其实和服务端绑定端口一样，其实并不是注册的时候就把对应的事情一起注册到`selector`上，而是在完成后，在通过`pipeline`传播的方式，也就是`pipeline.fireChannelActive();`这里进行传播，我们看看调用`doRegister();`放法的`register0()`的具体实现吧：

```java
// AbstractChannel.java
private void register0(ChannelPromise promise) {
    try {
        // check if the channel is still open as it could be closed in the mean time when the register
        // call was outside of the eventLoop
        if (!promise.setUncancellable() || !ensureOpen(promise)) {
            return;
        }
        // 首先是从来没有注册过，这里就是为true。
        boolean firstRegistration = neverRegistered;
        //这里进行注册。
        doRegister();
        // 修改状态。
        neverRegistered = false;
        registered = true;

        // Ensure we call handlerAdded(...) before we actually notify the promise. This is needed as the
        // user may already fire events through the pipeline in the ChannelFutureListener.
        pipeline.invokeHandlerAddedIfNeeded();

        safeSetSuccess(promise);
        pipeline.fireChannelRegistered();
        // Only fire a channelActive if the channel has never been registered. This prevents firing
        // multiple channel actives if the channel is deregistered and re-registered.
        // 因为客户端连接不需要绑定端口，只需要进行注册就行，所以这里isActive()为他true。
        if (isActive()) {
            if (firstRegistration) {
                // 在这里进行传播。
                pipeline.fireChannelActive();
            } else if (config().isAutoRead()) {
                // This channel was registered before and autoRead() is set. This means we need to begin read
                // again so that we process inbound data.
                //
                // See https://github.com/netty/netty/issues/4805
                beginRead();
            }
        }
    } catch (Throwable t) {
        // Close the channel directly to avoid FD leak.
        closeForcibly();
        closeFuture.setClosed();
        safeSetFailure(promise, t);
    }
}
```

`fireChannelActive`从pipeline的head开始传播，而head其实就是`HeadContext`类的一个实例，所以我们通过层层跟踪，那么也就在`DefaultChannelPipe`的内部类`HeadContext`中的`channelActive();`方法，源代码如下：

```java
// DefaultChannelPipeline.HeadContext.java
@Override
public void channelActive(ChannelHandlerContext ctx) throws Exception {
    ctx.fireChannelActive();

    readIfIsAutoRead();
}
```

其实看到这里就已经非常明白了，和服务端启动一样，绑定端口完成后，也是通过`pipeline.fireChannelActive();`进行传播，然后调用`readIfIsAutoRead();`然后调用`channel.read();`这个又会回到`pipeline.read();`不过这里是直接就是调用尾节点`tail.read();`，`tail` 和`head`一样，都是`HeadContext`类的一个实例。所以查看`HeadContext.read();`方法，最终还是回到了`channel.unsafe.beginRead();`方法。

和服务端的一样，也是将`netty`的`channel`上的`interestOps`重新添加到`selectionKey`上。唯一的区别就是服务端的`interestOps`是16，而新连接的`interestOps`是1，这里可以查看一下`NioServerSocketChannel`和`NioSocketChannel`构造函数的区别，前面传入的是`accept`事件，后面传入的是`read`事件。

## 总结

到这里，一个新的连接接入的流程我们已经分析完成了，从服务端绑定了端口以后就开始正式启动新连接的检测了，因为把感兴趣的`accept`事件绑定到了服务端的`selectionKey`上，表示这个对连接事件感兴趣。

然后服务端轮询到新连接后，先获取这个连接的`channel`然后将这个`JDK` 底层的`channel`封装成一个`NioSocketChannel`，然后通过服务端的`pipeline`进行传播，我们之前知道，在初始化服务端`channel`是，会往服务端`pipeline`添加一个特殊的`handler`，这个特殊的`handler`就是`ServerBootstrapAcceptor`，那么会从pipeline从head传播到这个`chandler`，而这个handler做的事情，就是从`childGroup`中选择一个`NioEventLoop` 进行selector的注册。

注册后又通过`pipeline.fireChannelActive();`进行通知，这里主要做的事情就是重新将`interestOps`绑定到`selectionKey`上，这个时候，已经完成了新连接的接入，说明这个连接已经可以接受对应的客户端发送的数据，也就是能进行`read`事件的检测。

从服务端启动到现在的新连接的接入，我们能发现，这个`pipeline`无处不在，也能看出来这个`pipeline` 的重要性，我们下篇文章就来详细讲解`pipeline`，如果想详细了解的，不妨点个关注，顺便关注一下微信公众号：**码农小谭**，你将会在我发布的第一时间收到消息~

> 微信公众号：码农小谭，一个热爱coding、生活、分享、探讨的打工人，如果我的文章对你有帮助，麻烦给个关注吧~
> 公众号分享技术博文、生活百事、欢迎关注~
> 资料获取方式，无任何套路，也不需要解压验证码，如下：
> 需要java相关资料请回复【java】
> 需要数据库相关资料请回复【数据库】
> 需要计算机网络相关资料请回复【计算机网络】
> 需要操作系统相关资料请回复【操作系统】
> 需要算法相关资料请回复【算法】
> 如果资料链接失效，请点击联系作者添加微信，第一时间会进行更新。

![](https://img.zeroable.cn/202204081144544.png)

