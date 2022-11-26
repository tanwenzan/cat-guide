---
title: netty源码解析02-NioEventLoop详解
date: 2021-10-08 10:17:55
tags:
  - netty
  - java
categories:
  - java
  - netty
---

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

> 提示:如果没有听过或者使用过`java nio` 和`netty`，不建议直接阅读此文章，建议先去了解`java nio `和`netty`之后再阅读此文章。

<!--more-->

# netty NioEventLoop详解

上一篇文章，我们介绍了netty的启动流程，我们知道了netty在jdk nio的基础上多做了哪些事情，在上篇文章中，我们接触到了netty 的一个核心组件，就是我们的NioEventLoop。那么我们这篇文章就来对NioEventLoop做一个详细的探索吧~

## 前言

如果在面试中遇到过面试官问到netty相关的面试题，或许以下的几个题目你不会陌生：

1. 默认情况下，netty服务端起多少个线程呢？什么时候启动呢？
2. 知道jdk nio 什么时候会出现空轮询导致CPU飙升到100%吗？netty又是如何解决了这个BUG呢？
3. netty是如何保证异步串行无锁化的？

## NioEventLoop 创建

NioEventLoop的创建其实就比较简单了，它是从创建EventLoopGroup开始的，你还记得我们上一节的demo代码中，有这么一行代码：`NioEventLoopGroup bossGroup = new NioEventLoopGroup();` 那么`NioEventLoop`就是从`new NioEventLoopGroup();`开始的。大致的流程我还是先告诉你：

1. `new NioEventLoopGroup();` 创建线程组，默认线程数量是cpu核数*2。
2. `new ThreadPreTaskExecutor();` 创建线程创建器。
3. `for(nThreads){newChild()}` 创建对应数量的`NioEventLoop`，每个`NioEventLoop`对应一个线程。
4. `chooser = chooserFactory.newChooser(children);`通过这个创建一个线程选择器，以后netty执行对应的事件，就通过这个选择器来选择哪一个`NioEventLoop`来进行执行。

我们一起去看看这个`EventLoopGroup`的构造函数做了哪些事情吧：

```java
//EventLoopGroup.java
//第一步，从这里开始。
public NioEventLoopGroup() {
    this(0);
}
//第二步，依次调用对应的构造函数。
public NioEventLoopGroup(int nThreads) {
    //这里调用了一个新的构造函数，并且传入了一个Executor,为null，这里Executor的作用就是来创建NioEventLoop对应的底层的线程。
    this(nThreads, (Executor) null);
}
//第三步，依次调用对应的构造函数。
public NioEventLoopGroup(int nThreads, Executor executor) {
    //这里又多了一个参数provider，它的作用就是创建每个NioEventLoop对应的selector,对于这个，后面我们会讲到，不需要着急。
    this(nThreads, executor, SelectorProvider.provider());
}
//第四步，依次调用对应的构造函数。
public NioEventLoopGroup(
    int nThreads, Executor executor, final SelectorProvider selectorProvider) {
    this(nThreads, executor, selectorProvider, DefaultSelectStrategyFactory.INSTANCE);
}
//第五步，依次调用对应的构造函数。
public NioEventLoopGroup(int nThreads, Executor executor, final SelectorProvider selectorProvider,
                         final SelectStrategyFactory selectStrategyFactory) {
    super(nThreads, executor, selectorProvider, selectStrategyFactory, RejectedExecutionHandlers.reject());
}
//MultithreadEventLoopGroup.java
//第六步，依次调用对应的构造函数。
protected MultithreadEventLoopGroup(int nThreads, Executor executor, Object... args) {
    super(nThreads == 0 ? DEFAULT_EVENT_LOOP_THREADS : nThreads, executor, args);
}
//MultithreadEventExecutorGroup.java
//第七步，依次调用对应的构造函数。
protected MultithreadEventExecutorGroup(int nThreads, Executor executor, Object... args) {
    this(nThreads, executor, DefaultEventExecutorChooserFactory.INSTANCE, args);
}
//第八步，依次调用对应的构造函数。最终来到了我们重要的地方。
protected MultithreadEventExecutorGroup(int nThreads, Executor executor,
                                        EventExecutorChooserFactory chooserFactory, Object... args) {
    if (nThreads <= 0) {
        throw new IllegalArgumentException(String.format("nThreads: %d (expected: > 0)", nThreads));
    }
	
    //这里就是第一步，创建一个线程创建器。作用在上面的注释已经解释过了，是用于创建NioEventLoop底层的线程。
    if (executor == null) {
        //newDefaultThreadFactory()就是去创建线程。
        executor = new ThreadPerTaskExecutor(newDefaultThreadFactory());
    }
	
    //创建对用线程数量的EventExecutor数组
    children = new EventExecutor[nThreads];

    //通过一个for循环，去创建一个相同数量的NioEventLoop
    for (int i = 0; i < nThreads; i ++) {
        boolean success = false;
        try {
            //我们来看看这个newChild做了什么事情
            children[i] = newChild做了什么事情(executor, args);
            success = true;
        } catch (Exception e) {
            // TODO: Think about if this is a good exception type
            throw new IllegalStateException("failed to create a child event loop", e);
        } finally {
            //这里当创建失败的时候，去关闭。
            if (!success) {
                for (int j = 0; j < i; j ++) {
                    children[j].shutdownGracefully();
                }

                for (int j = 0; j < i; j ++) {
                    EventExecutor e = children[j];
                    try {
                        while (!e.isTerminated()) {
                            e.awaitTermination(Integer.MAX_VALUE, TimeUnit.SECONDS);
                        }
                    } catch (InterruptedException interrupted) {
                        // Let the caller handle the interruption.
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
    }
	//第三步，通过这个工厂类创建一个线程选择器。
    chooser = chooserFactory.newChooser(children);

    final FutureListener<Object> terminationListener = new FutureListener<Object>() {
        @Override
        public void operationComplete(Future<Object> future) throws Exception {
            if (terminatedChildren.incrementAndGet() == children.length) {
                terminationFuture.setSuccess(null);
            }
        }
    };

    for (EventExecutor e: children) {
        e.terminationFuture().addListener(terminationListener);
    }

    Set<EventExecutor> childrenSet = new LinkedHashSet<EventExecutor>(children.length);
    Collections.addAll(childrenSet, children);
    readonlyChildren = Collections.unmodifiableSet(childrenSet);
}
```

上面源代码中的注释，我们知道上述这个三个步骤是在源码中的哪个地方，那么我们现在来深入分析这个三个步骤吧。

### Executor

我们通过上述代码知道，`executor`开始的时候是`null`，通过`executor = new ThreadPerTaskExecutor(newDefaultThreadFactory());`进行赋值。首先我们看看这个`newDefaultThreadFactory();`做了什么事情，代码如下：

```java
//MultithreadEventExecutorGroup.java
//第一步，创建了一个默认的线程创建工厂类。
protected ThreadFactory newDefaultThreadFactory() {
    return new DefaultThreadFactory(getClass());
}
//DefaultThreadFactory.java
//第二步，进入对应的构造函数。
public DefaultThreadFactory(Class<?> poolType) {
    this(poolType, false, Thread.NORM_PRIORITY);
}
//第三步，进入对应的构造函数。
public DefaultThreadFactory(Class<?> poolType, boolean daemon, int priority) {
    //这里的toPoolName方法就是将class的全类名通过StringUtil.simpleClassName(poolType);进行简化，去除了前面的包名称。
    //如果转化之后成className长度为0，那么就返回字符串"unknown"。
    //如果转化之后成className长度为1，那么就把lassName转成小写，然后返回。
    //否则，如果className第一个字母是大写，并且第二个字母是小写时。那么久将第一个字母转化成小写然后返回，如果不是，那么就直接返回className。
    this(toPoolName(poolType), daemon, priority);
}

public DefaultThreadFactory(String poolName, boolean daemon, int priority, ThreadGroup threadGroup) {
    if (poolName == null) {
        throw new NullPointerException("poolName");
    }
    if (priority < Thread.MIN_PRIORITY || priority > Thread.MAX_PRIORITY) {
        throw new IllegalArgumentException(
            "priority: " + priority + " (expected: Thread.MIN_PRIORITY <= priority <= Thread.MAX_PRIORITY)");
    }
	//这里就是保存线程名称的前缀。也就是 nioEventLoopGroup-id-
    //注意，有的文章和视频把nioEventLoopGroup说成了nioEventLoop。这是错的，因为整体都是从 new NioEventLoopGroup();开始的，所以getCalss()
    //自然而然就是NioEventLoopGroup 而不是NioEventLoop，这里注意一下就行，我把debug模式下的内容截图下来了，有图有真相~
    prefix = poolName + '-' + poolId.incrementAndGet() + '-';
    this.daemon = daemon;
    this.priority = priority;
    this.threadGroup = threadGroup;
}
```

下面这张图就是为了说明这个`poolName`是`nioEventLoopGroup` 而并非是其他文章和视频所说的`nioEventLoop`。其实真正阅读和调试过源码的人不会出现这种低级错误，所以，懂得都懂~

![](https://img.zeroable.cn/202204081427344.png)


上面我们分析过了创建线程的DefaultThreadFactory的构造函数了，那么我们接下来看看这个`ThreadPerTaskExecutor`做了什么事情吧：

```java
//ThreadPerTaskExecutor.java
//
public ThreadPerTaskExecutor(ThreadFactory threadFactory) {
    if (threadFactory == null) {
        throw new NullPointerException("threadFactory");
    }
    //就是把创建的线程创建工厂类保存起来。
    this.threadFactory = threadFactory;
}

@Override
public void execute(Runnable command) {
    //每次执行task任务时，都会创建一个新的线程，去执行task。
    threadFactory.newThread(command).start();
}
//DefaultThreadFactory.java
//通过这里的newThread方法去创建一个新的线程。
@Override
public Thread newThread(Runnable r) {
    //这里netty使用的自己的一个DefaultRunnableDecorator,它implements了Runnable类。 
    Thread t = newThread(new DefaultRunnableDecorator(r), prefix + nextId.incrementAndGet());
    try {
        if (t.isDaemon()) {
            if (!daemon) {
                t.setDaemon(false);
            }
        } else {
            if (daemon) {
                t.setDaemon(true);
            }
        }

        if (t.getPriority() != priority) {
            t.setPriority(priority);
        }
    } catch (Exception ignored) {
        // Doesn't matter even if failed to set.
    }
    return t;
}
//这里它自己创建了一个FastThreadLocalThread，它继承自Thread，netty这么做的目的，就是对Thread中的ThreadLocal做进一步的优化。
//后续会讲到这个，感兴趣的可以自己先去研究研究。
protected Thread newThread(Runnable r, String name) {
    return new FastThreadLocalThread(threadGroup, r, name);
}

```

 到这里，我们知道了这个`ThreadPerTaskExecutor`做了什么事情。他主要是在每次执行任务的时候，都会创建一个线程实例。并且线程名称的规则就是`nioEventLoopGroup-poolId-threadId` 这样的格式。

### newChild()

上面讲到`newChild()` 是去创建`NioEventLoop`，其中`NioEventLoop`构造函数做了以下几件事情：

1. 保存上面创建的线程执行器`ThreadPerTaskExecutor`。
2. 创建一个队列`MpscQueue`。
3. 创建一个`selector`。

我们来看看具体实现：

```java
//NioEventLoopGroup.java
@Override
protected EventLoop newChild(Executor executor, Object... args) throws Exception {
    return new NioEventLoop(this, executor, (SelectorProvider) args[0],
                            ((SelectStrategyFactory) args[1]).newSelectStrategy(), (RejectedExecutionHandler) args[2]);
}
//NioEventLoop.java
NioEventLoop(NioEventLoopGroup parent, Executor executor, SelectorProvider selectorProvider,
             SelectStrategy strategy, RejectedExecutionHandler rejectedExecutionHandler) {
    super(parent, executor, false, DEFAULT_MAX_PENDING_TASKS, rejectedExecutionHandler);
    if (selectorProvider == null) {
        throw new NullPointerException("selectorProvider");
    }
    if (strategy == null) {
        throw new NullPointerException("selectStrategy");
    }
    //这里就进行一些保存变量操作。
    provider = selectorProvider;
    //第三步，通过openSelector();创建一个selector。那么也就是一个NioEventLoop对应一个selector。
    selector = openSelector();
    selectStrategy = strategy;
}
//SingleThreadEventLoop.java
//这里就是第二步
protected SingleThreadEventLoop(EventLoopGroup parent, Executor executor,
                                boolean addTaskWakesUp, int maxPendingTasks,
                                RejectedExecutionHandler rejectedExecutionHandler) {
    super(parent, executor, addTaskWakesUp, maxPendingTasks, rejectedExecutionHandler);
    tailTasks = newTaskQueue(maxPendingTasks);
}

//SingleThreadEventExecutor.java
//这里就是第一步，，创建了taskQueue。
protected SingleThreadEventExecutor(EventExecutorGroup parent, Executor executor,
                                    boolean addTaskWakesUp, int maxPendingTasks,
                                    RejectedExecutionHandler rejectedHandler) {
    super(parent);
    this.addTaskWakesUp = addTaskWakesUp;
    this.maxPendingTasks = Math.max(16, maxPendingTasks);
    this.executor = ObjectUtil.checkNotNull(executor, "executor");
    taskQueue = newTaskQueue(this.maxPendingTasks);
    rejectedExecutionHandler = ObjectUtil.checkNotNull(rejectedHandler, "rejectedHandler");
}
//
@Override
protected Queue<Runnable> newTaskQueue(int maxPendingTasks) {
    // This event loop never calls takeTask()
    //multiple producers and a single consumer，这里multiple producers 对应的就是外部线程。consumer就是对应NioEventLoop.
    //也就是说外部线程(非NioEventLoop线程执行)可以把任务交给NioEventLoop去消费。
    return PlatformDependent.newMpscQueue(maxPendingTasks);
}
```

那么我们NioEventLoop的创建过程就搞明白了，但是创建了这么多个`NioEventLoop`，那么我们该怎么去选择哪一个`NioEventLoop`去执行任务呢？这时候线程选择器就至关重要了，`netty`就是通过`chooser = chooserFactory.newChooser(children);`来创建一个线程选择器。

### newChooser()

而这个chooser就是为了给每一个新连接绑定对应的`NioEventLoop`，那么对应的方法就在`NioEventLoopGroup`中的`next();`方法中，我们一起来看下吧~

```java
//MultithreadEventExecutorGroup.java  NioEventLoopGroup的父类。
@Override
public EventExecutor next() {
    //其实原理非常的简单。就是依次选择，第一个连接使用第一个NioEventLoop。。。第N个使用第N个NioEventLoop，第N+1个连接就从头开始，使用第一个连接。
    //N为当初创建线程数量。默认为CPU核数的俩倍。
    //这里netty也做了一些优化，就是判断这个N是否为2的n次幂。如果是2的n次幂，那么就直接使用位操作进行选择，否则使用我们的取余操作。
    //这里其实chooserFactory.newChooser(children);会判断，然后创建俩个不同的实体。具体实现方法如下：
    return chooser.next();
}
//DefaultEventExecutorChooserFactory.java
@Override
public EventExecutorChooser newChooser(EventExecutor[] executors) {
    //判断executors.length是否为2的n次方
    if (isPowerOfTwo(executors.length)) {
        return new PowerOfTowEventExecutorChooser(executors);
    } else {
        return new GenericEventExecutorChooser(executors);
    }
}
private static final class PowerOfTowEventExecutorChooser implements EventExecutorChooser {
    private final AtomicInteger idx = new AtomicInteger();
    private final EventExecutor[] executors;

    PowerOfTowEventExecutorChooser(EventExecutor[] executors) {
        this.executors = executors;
    }

    @Override
    public EventExecutor next() {
        //这里直接就进行位操作来选择，速度会比取余快上很多，但前提是executors.length必须是2的n次方
        //这里不明白的可以去多试几次。就明白了。
        return executors[idx.getAndIncrement() & executors.length - 1];
    }
}

private static final class GenericEventExecutorChooser implements EventExecutorChooser {
    private final AtomicInteger idx = new AtomicInteger();
    private final EventExecutor[] executors;

    GenericEventExecutorChooser(EventExecutor[] executors) {
        this.executors = executors;
    }

    @Override
    public EventExecutor next() {
        //这里直接就只能进行取余操作了，因为executors.length不是2的n次方
        return executors[Math.abs(idx.getAndIncrement() % executors.length)];
    }
}
```

到这里，我们就弄懂了`NioEventLoop`的创建，以及如果去选择哪一个`NioEventLoop`去实行任务。那么我们接下来去了解`NioEventLoop`是怎么被启动起来的。

## NioEventLoop 启动

这里有俩个地方启动了，第一个就是我们之前说的绑定端口的时候，其实就是在`NioEventLoop`中的线程进行创建的。第二个就是新连接接入时，通过`chooser`来绑定`NioEventLoop`。这个后续会有文章详细讲解新连接接入流程。这里就以第一个为例，服务端绑定端口的时候，就是在`doBind0();`方法中调用了`executor();` 我们一起来回忆一吧：

```java
//AbstractBootstrap.java
private static void doBind0(
    final ChannelFuture regFuture, final Channel channel,
    final SocketAddress localAddress, final ChannelPromise promise) {

    // This method is invoked before channelRegistered() is triggered.  Give user handlers a chance to set up
    // the pipeline in its channelRegistered() implementation.
    //这里就是使用了NioEventLoop的线程去执行绑定操作。
    channel.eventLoop().execute(new Runnable() {
        @Override
        public void run() {
            if (regFuture.isSuccess()) {
                channel.bind(localAddress, promise).addListener(ChannelFutureListener.CLOSE_ON_FAILURE);
            } else {
                promise.setFailure(regFuture.cause());
            }
        }
    });
}
//SingleThreadEventExecutor.java
@Override
public void execute(Runnable task) {
    if (task == null) {
        throw new NullPointerException("task");
    }
	//判断当前执行的线程是否是NioEventLoop线程中，其实服务端启动的过程中，是通过主线程去启动的，也就是main线程。所以inEventLoop为false。
    boolean inEventLoop = inEventLoop();
    if (inEventLoop) {
        addTask(task);
    } else {
        startThread();
        addTask(task);
        if (isShutdown() && removeTask(task)) {
            reject();
        }
    }

    if (!addTaskWakesUp && wakesUpForTask(task)) {
        wakeup(inEventLoop);
    }
}
//AbstractEventExecutor.java
@Override
public boolean inEventLoop() {
    //将当前线程传入，这里当前线程为main。
    return inEventLoop(Thread.currentThread());
}

//SingleThreadEventExecutor.java
@Override
public boolean inEventLoop(Thread thread) {
    return thread == this.thread;
}
private void startThread() {
    //判断当前线程是否是未启动。
    if (STATE_UPDATER.get(this) == ST_NOT_STARTED) {
        //通过一个cas操作，来进行开启线程，这里就是防止多个线程同时调用同一个NioEventLoop实例执行这段代码，造成线程不安全。
        if (STATE_UPDATER.compareAndSet(this, ST_NOT_STARTED, ST_STARTED)) {
            //然后我们来看看这个方法
            doStartThread();
        }
    }
}
private void doStartThread() {
    assert thread == null;
    //这里其实就是通过executor的execute方法。我们前面分析过了，它其实就是通过那个ThreadFactory进行创建一个新的线程去执行这个任务。
    executor.execute(new Runnable() {
        @Override
        public void run() {
            //拿到当前线程，并保存。这里就是进行NioEventLoop 和线程进行唯一的绑定。
            thread = Thread.currentThread();
            if (interrupted) {
                thread.interrupt();
            }

            boolean success = false;
            updateLastExecutionTime();
            try {
                //然后去调用NioEventLoop的run方法。这里就是实际的调用。
                SingleThreadEventExecutor.this.run();
                success = true;
            } catch (Throwable t) {
                logger.warn("Unexpected exception from an event executor: ", t);
            } finally {
                for (;;) {
                    int oldState = STATE_UPDATER.get(SingleThreadEventExecutor.this);
                    if (oldState >= ST_SHUTTING_DOWN || STATE_UPDATER.compareAndSet(
                        SingleThreadEventExecutor.this, oldState, ST_SHUTTING_DOWN)) {
                        break;
                    }
                }

                // Check if confirmShutdown() was called at the end of the loop.
                if (success && gracefulShutdownStartTime == 0) {
                    logger.error("Buggy " + EventExecutor.class.getSimpleName() + " implementation; " +
                                 SingleThreadEventExecutor.class.getSimpleName() + ".confirmShutdown() must be called " +
                                 "before run() implementation terminates.");
                }

                try {
                    // Run all remaining tasks and shutdown hooks.
                    for (;;) {
                        if (confirmShutdown()) {
                            break;
                        }
                    }
                } finally {
                    try {
                        cleanup();
                    } finally {
                        STATE_UPDATER.set(SingleThreadEventExecutor.this, ST_TERMINATED);
                        threadLock.release();
                        if (!taskQueue.isEmpty()) {
                            logger.warn(
                                "An event executor terminated with " +
                                "non-empty task queue (" + taskQueue.size() + ')');
                        }

                        terminationFuture.setSuccess(null);
                    }
                }
            }
        }
    });
}
```

到这里，我们知道了NioEventLoop的启动过程，我们以服务端启动时绑定端口进行举例，通过`eventLoop.execute`进行启动。最后的执行就是在NioEventLoop中的run();方法。

## NioEventLoop IO 事件的检测和处理

```java
@Override
protected void run() {
    for (;;) {
        try {
            //这里进行轮询IO事件。
            switch (selectStrategy.calculateStrategy(selectNowSupplier, hasTasks())) {
                case SelectStrategy.CONTINUE:
                    continue;
                case SelectStrategy.SELECT:
                    // 重点在这里。这里有一个wakenUp标识，标识当前select操作是否被唤醒。每次进行select操作时
                    // 将标识置为false。表示需要进行select操作，并且表示是未唤醒状态。
                    // 这里wakeUp是可以被外部线程唤醒的。 
                    select(wakenUp.getAndSet(false));
                    if (wakenUp.get()) {
                        selector.wakeup();
                    }
                default:
                    // fallthrough
            }
            //暂时不重要的代码进行省略
            processSelectedKeys();
    }
}
```

从上面代码中，我们知道，select方法是最重要的，所以我们来看看select方法到底做了什么吧。

```java
private void select(boolean oldWakenUp) throws IOException {
    Selector selector = this.selector;
    try {
        int selectCnt = 0;
        // 首先，获取当前时间。
        long currentTimeNanos = System.nanoTime();
        // 然后当前时间加上截止时间。这里我们需要知道，NioEventLoop底层有一个定时任务队列，如果感兴趣的可以先去了解一下，
        // 后面会说到，这个定时任务队列就是按照任务的截止时间排序的一个具有优先级别的队列。这里的delayNanos方法就是用来计算这个定时任务
        // 队列第一个任务的截止时间，这里后面会说到，感兴趣的自己可以先去了解一下。所以这个selectDeadLineNanos就是当前执行select操作最长不能超过selectDeadLineNanos时间。
        long selectDeadLineNanos = currentTimeNanos + delayNanos(currentTimeNanos);
        for (;;) {
            // 先获取超时时间，如果操作超时了，并且一次也没有进行select,那么就进行一个非阻塞的selectNow。并且将selectCnt设置为1。
            
            long timeoutMillis = (selectDeadLineNanos - currentTimeNanos + 500000L) / 1000000L;
            if (timeoutMillis <= 0) {
                if (selectCnt == 0) {
                    selector.selectNow();
                    selectCnt = 1;
                }
                break;
            }

            // If a task was submitted when wakenUp value was true, the task didn't get a chance to call
            // Selector#wakeup. So we need to check task queue again before executing select operation.
            // If we don't, the task might be pended until select operation was timed out.
            // It might be pended until idle timeout if IdleStateHandler existed in pipeline.
            //如果没有到截止时间，如果当前有任务，也就是taskQueue不为空，并且通过cas操作将wakeUp在select执行前改为false改为true,注意，这个wakeUp是可以被外部线程修改的，也就是select操作是可以被外部线程唤醒的，所以这里到这里前没有被外部线程唤醒过。
            // 如果俩个条件都满足要求，那么就执行一个非阻塞的select操作，并将selectCnt设置为1，也就是select次数。然后跳出循环，结束此次select操作。
            if (hasTasks() && wakenUp.compareAndSet(false, true)) {
                selector.selectNow();
                selectCnt = 1;
                break;
            }
			// 如果当前任务队列为空，并且阻塞时间没到，那么就进行一个阻塞式的select。
            // 这个selectedKeys表示轮询到的事件，如果等于0，表示当前没有事件。
            int selectedKeys = selector.select(timeoutMillis);
            // 轮询次数加一。
            selectCnt ++;
			// 也就是当满足如下任意一个条件时，就会跳出循环，结束select操作：
            // 1. 当前轮询到了事件，也就是selectedKeys不等于0.
            // 2. 这个select操作需要被唤醒。
            // 3. 当前wakeUp被外部线程修改，表示这个select操作需要被唤醒
            // 4. 任务队列中有任务。
            // 5. 定时任务队列中存在任务。
            
            if (selectedKeys != 0 || oldWakenUp || wakenUp.get() || hasTasks() || hasScheduledTasks()) {
                // - Selected something,
                // - waken up by user, or
                // - the task queue has a pending task.
                // - a scheduled task is ready for processing
                break;
            }
            // 如果当前线程被中断。
            if (Thread.interrupted()) {
                // Thread was interrupted so reset selected keys and break so we not run into a busy loop.
                // As this is most likely a bug in the handler of the user or it's client library we will
                // also log it.
                //
                // See https://github.com/netty/netty/issues/2426
                if (logger.isDebugEnabled()) {
                    logger.debug("Selector.select() returned prematurely because " +
                                 "Thread.currentThread().interrupt() was called. Use " +
                                 "NioEventLoop.shutdownGracefully() to shutdown the NioEventLoop.");
                }
                selectCnt = 1;
                break;
            }
			//这里就对jdk空轮询的bug用一种巧妙的方式给解决了。敲黑板，这里面试经常问到。
            long time = System.nanoTime();
            // 这里就是表示如果阻塞完后的当前之间与开始时间之间的时间间隔超过了超时时间，那么此次select结束。
            if (time - TimeUnit.MILLISECONDS.toNanos(timeoutMillis) >= currentTimeNanos) {
                // timeoutMillis elapsed without anything selected.
                //到这里，那么就意味着已经执行过一次阻塞式的select操作了。
                selectCnt = 1;
                // 那么反过来说明了本来需要阻塞timeoutMillis那么久，但是实际上并没有阻塞这么久，select方法就被唤醒了。
                // 这里极限情况下就造成了空轮询，因为在一些极端情况下，可能select并没有进行阻塞，立马返回了，这就导致了一直在死循环
                // 这就导致了空轮询，照成了cpu飙升100%。这种极端情况之一就是连接出现了RST，
                // 因为poll和epoll对于突然中断的连接socket会对返回的eventSet事件集合置为POLLHUP或者POLLERR，
                // eventSet事件集合发生了变化，这就导致Selector会被唤醒，进而导致CPU 100%问题。
                // 根本原因就是JDK没有处理好这种情况，比如SelectionKey中就没定义有异常事件的类型。
                // 上述描述来自于：https://zhuanlan.zhihu.com/p/92133508 可以去自己查看。
            } else if (SELECTOR_AUTO_REBUILD_THRESHOLD > 0 &&
                       selectCnt >= SELECTOR_AUTO_REBUILD_THRESHOLD) {
                // 那么netty在这里使用了一个非常巧妙的方式，就是这种情况连续空轮询了一定次数后(512次)，说明这个select已经出现了问题，
                // 那么就将selector上原来的事件和属性重新注册到一个新的selector上，从而解决了空轮询的bug。
                // The selector returned prematurely many times in a row.
                // Rebuild the selector to work around the problem.
                logger.warn(
                    "Selector.select() returned prematurely {} times in a row; rebuilding Selector {}.",
                    selectCnt, selector);
				// 这个方法就不点进去查看了，自己可以去查看一下，原理非常简单，就是重新进行注册到新的selector上，并且重新绑定selector。
                rebuildSelector();
                // 这时候就将局部变量重新赋值。
                selector = this.selector;
				
                // Select again to populate selectedKeys.
                selector.selectNow();
                selectCnt = 1;
                break;
            }

            currentTimeNanos = time;
        }

        if (selectCnt > MIN_PREMATURE_SELECTOR_RETURNS) {
            if (logger.isDebugEnabled()) {
                logger.debug("Selector.select() returned prematurely {} times in a row for Selector {}.",
                             selectCnt - 1, selector);
            }
        }
    } catch (CancelledKeyException e) {
        if (logger.isDebugEnabled()) {
            logger.debug(CancelledKeyException.class.getSimpleName() + " raised by a Selector {} - JDK bug?",
                         selector, e);
        }
        // Harmless exception - log anyway
    }
}
```

上面我们重点讲到了select方法，就是当有事件或者有任务或者定时任务时，那么就结束select操作，也就是说，它只是去查找，直到有事件或者任务，才会结束，那么下面我们来说说找到事件之后，怎么去进行处理这些时间，netty就是通过`processSelectedKeys();`进行处理IO事件的。处理流程大致如下：

1. select keySet 集合的优化，将底层的hashSet通过反射将hashSet替换成数组。那么将select操作的时间复杂度变成了O(1);这个优化放在了NioEventLoop的构造函数中，也就是`openSelector();`方法。
2. 调用`processSelectedKeysOptimized();`真正的处理IO事件。

我们来看看他的优化过程吧：

```java
private Selector openSelector() {
    final Selector selector;
    try {
        selector = provider.openSelector();
    } catch (IOException e) {
        throw new ChannelException("failed to open a new selector", e);
    }

    // 这里表示是否需要去进行优化。
    if (DISABLE_KEYSET_OPTIMIZATION) {
        return selector;
    }
	// 在这里，使用了一个自定义的Set进行保存selectKeys，在4.1.6.Final版本时使用了俩个数组进行交替实现，使用flip进行切换，他只实现了
    final SelectedSelectionKeySet selectedKeySet = new SelectedSelectionKeySet();
	// 省略暂时不需要的代码，我们直接看看SelectedSelectionKeySet的代码：
    // 他其实还是实现了Set接口，但是其底层实现使用了俩个数组，当前源码版本是4.1.6.Final。
    // 但是在最新的版本中只用到了一个数组，这是因为他想通过俩个数组进行交替实现，但是对于这个SelectedSelectionKeySet只是单线程的处理。
    // 所以有人提了一个issues，作者也认可了，在最新版本修改了，使用了一个数组。
    final class SelectedSelectionKeySet extends AbstractSet<SelectionKey> {
        private SelectionKey[] keysA;
        private int keysASize;
        private SelectionKey[] keysB;
        private int keysBSize;
        private boolean isA = true;

        //创建了一个大小为1024的数组。
        SelectedSelectionKeySet() {
            keysA = new SelectionKey[1024];
            keysB = keysA.clone();
        }

        // 就是在这里进行了一个优化，因为jdk Nio 使用的是一个HashSet，我们知道，HashSet他使用的又是一个Hashmap。
        // HashMap的add方法时间复杂度并不稳定，最坏的可以达到O(n)。所以这里netty作者自己使用数组实现了一个KeySet。
        @Override
        public boolean add(SelectionKey o) {
            if (o == null) {
                return false;
            }
			// 这是因为是单线程的，所以可以这样直接操作。
            if (isA) {
                int size = keysASize;
                keysA[size ++] = o;
                keysASize = size;
                //如果容量不够，就进行扩容。
                if (size == keysA.length) {
                    doubleCapacityA();
                }
            } else {
                int size = keysBSize;
                keysB[size ++] = o;
                keysBSize = size;
                if (size == keysB.length) {
                    doubleCapacityB();
                }
            }

            return true;
        }
		
        // 这里没啥好说的，就是对数组进行双倍扩容。
        private void doubleCapacityA() {
            SelectionKey[] newKeysA = new SelectionKey[keysA.length << 1];
            System.arraycopy(keysA, 0, newKeysA, 0, keysASize);
            keysA = newKeysA;
        }
        
		// 这里没啥好说的，就是对数组进行双倍扩容。
        private void doubleCapacityB() {
            SelectionKey[] newKeysB = new SelectionKey[keysB.length << 1];
            System.arraycopy(keysB, 0, newKeysB, 0, keysBSize);
            keysB = newKeysB;
        }

        //通过这个获取SelectionKey数组，并且获取
        SelectionKey[] flip() {
            if (isA) {
                isA = false;
                keysA[keysASize] = null;
                keysBSize = 0;
                return keysA;
            } else {
                isA = true;
                keysB[keysBSize] = null;
                keysASize = 0;
                return keysB;
            }
        }

        @Override
        public int size() {
            if (isA) {
                return keysASize;
            } else {
                return keysBSize;
            }
        }

        // 这三个方法是不支持的，因为使用SelectedSelectionKeySet时，
        // 并不需要使用这三个方法，这也就是为啥能使用数组去实现KeySet。
        @Override
        public boolean remove(Object o) {
            return false;
        }

        @Override
        public boolean contains(Object o) {
            return false;
        }

        @Override
        public Iterator<SelectionKey> iterator() {
            throw new UnsupportedOperationException();
        }
    }
}
```

看完`SelectedSelectionKeySet` 我们继续顺着`openSelector();`后面的方法查看：

```java
// 这里其实就是使用了反射的方式得到SelectorImpl类对象。
Object maybeSelectorImplClass = AccessController.doPrivileged(new PrivilegedAction<Object>() {
    @Override
    public Object run() {
        try {
            return Class.forName(
                "sun.nio.ch.SelectorImpl",
                false,
                PlatformDependent.getSystemClassLoader());
        } catch (ClassNotFoundException e) {
            return e;
        } catch (SecurityException e) {
            return e;
        }
    }
});
// 这里判断是否是一个Calss对象，并且判断这个selector是否这个maybeSelectorImplClass的一个实现。
if (!(maybeSelectorImplClass instanceof Class) ||
    // ensure the current selector implementation is what we can instrument.
    !((Class<?>) maybeSelectorImplClass).isAssignableFrom(selector.getClass())) {
    if (maybeSelectorImplClass instanceof Exception) {
        Exception e = (Exception) maybeSelectorImplClass;
        logger.trace("failed to instrument a special java.util.Set into: {}", selector, e);
    }
    // 如果不是他的实现，并且通过反射拿到的selectorImpl类对象并没有报错，那么就直接返回该selector。
    return selector;
}
// 如果是他的实现。
final Class<?> selectorImplClass = (Class<?>) maybeSelectorImplClass;

Object maybeException = AccessController.doPrivileged(new PrivilegedAction<Object>() {
    @Override
    public Object run() {
        try {
            // 这里就通过反射的方式，拿到俩个属性，分别是selectedKeys 和 publicSelectedKeys。
            Field selectedKeysField = selectorImplClass.getDeclaredField("selectedKeys");
            Field publicSelectedKeysField = selectorImplClass.getDeclaredField("publicSelectedKeys");
			// 下面就是标准的通过反射进行赋值。
            selectedKeysField.setAccessible(true);
            publicSelectedKeysField.setAccessible(true);
			// 将jdk Nio 里面的HashSet替换成netty自己的selectedKeySet。
            selectedKeysField.set(selector, selectedKeySet);
            publicSelectedKeysField.set(selector, selectedKeySet);
            return null;
        } catch (NoSuchFieldException e) {
            return e;
        } catch (IllegalAccessException e) {
            return e;
        } catch (RuntimeException e) {
            // JDK 9 can throw an inaccessible object exception here; since Netty compiles
            // against JDK 7 and this exception was only added in JDK 9, we have to weakly
            // check the type
            if ("java.lang.reflect.InaccessibleObjectException".equals(e.getClass().getName())) {
                return e;
            } else {
                throw e;
            }
        }
    }
});

if (maybeException instanceof Exception) {
    selectedKeys = null;
    Exception e = (Exception) maybeException;
    logger.trace("failed to instrument a special java.util.Set into: {}", selector, e);
} else {
    // 这里就将selectedKeySet 保存到NioEventLoop 的成员变量selectedKeys中。
    selectedKeys = selectedKeySet;
    logger.trace("instrumented a special java.util.Set into: {}", selector);
}

return selector;
```

那么到这里，我们就知道了netty对selectedKeys的优化，通过netty自己实现的一个set，将add方法进行优化，使得add方法的时间复杂度降到了`O(1)`。

然后我们继续往下，最终执行完`select();`方法后，会执行`processSelectedKeys();`那么我们查看一下`processSelectedKeys();`有关的的源码：

```java
private void processSelectedKeys() {
    if (selectedKeys != null) {
        processSelectedKeysOptimized(selectedKeys.flip());
    } else {
        processSelectedKeysPlain(selector.selectedKeys());
    }
}
// 最终会调用到这个方法里面。
private void processSelectedKeysOptimized(SelectionKey[] selectedKeys) {
    // 遍历selectedKeys
    for (int i = 0;; i ++) {
        final SelectionKey k = selectedKeys[i];
        if (k == null) {
            break;
        }
        // null out entry in the array to allow to have it GC'ed once the Channel close
        // See https://github.com/netty/netty/issues/2363
        selectedKeys[i] = null;

        // 这里你们是否还记得这个a变量是啥吗？在我们之前注册的时候，将NioServerSocketChannel 当作一个attachment，绑定到了这个Jdk Channel 中，这里可以通过SelectionKey实例拿到。
        final Object a = k.attachment();

        if (a instanceof AbstractNioChannel) {
            // 我们看看这个方法的具体实现。
            processSelectedKey(k, (AbstractNioChannel) a);
        } else {
            @SuppressWarnings("unchecked")
            NioTask<SelectableChannel> task = (NioTask<SelectableChannel>) a;
            processSelectedKey(k, task);
        }

        if (needsToSelectAgain) {
            // null out entries in the array to allow to have it GC'ed once the Channel close
            // See https://github.com/netty/netty/issues/2363
            for (;;) {
                i++;
                if (selectedKeys[i] == null) {
                    break;
                }
                selectedKeys[i] = null;
            }

            selectAgain();
            // Need to flip the optimized selectedKeys to get the right reference to the array
            // and reset the index to -1 which will then set to 0 on the for loop
            // to start over again.
            //
            // See https://github.com/netty/netty/issues/1523
            selectedKeys = this.selectedKeys.flip();
            i = -1;
        }
    }
}

private void processSelectedKey(SelectionKey k, AbstractNioChannel ch) {
    // 拿到这个channel的unsafe。
    final AbstractNioChannel.NioUnsafe unsafe = ch.unsafe();
    // 判断这个SelectionKey是否合法，因为这个连接可能有点问题
    if (!k.isValid()) {
        final EventLoop eventLoop;
        try {
            eventLoop = ch.eventLoop();
        } catch (Throwable ignored) {
            // If the channel implementation throws an exception because there is no event loop, we ignore this
            // because we are only trying to determine if ch is registered to this event loop and thus has authority
            // to close ch.
            return;
        }
        // Only close ch if ch is still registerd to this EventLoop. ch could have deregistered from the event loop
        // and thus the SelectionKey could be cancelled as part of the deregistration process, but the channel is
        // still healthy and should not be closed.
        // See https://github.com/netty/netty/issues/5125
        if (eventLoop != this || eventLoop == null) {
            return;
        }
        // close the channel if the key is not valid anymore
        // 那么就调用unsafe 的close方法。其实就是使用pipeline进行操作。关于pipeline，后面我们会讲到。
        unsafe.close(unsafe.voidPromise());
        return;
    }

    try {
        // 如果是合法的，就拿到这个SelectionKey上的IO事件。
        int readyOps = k.readyOps();
        // We first need to call finishConnect() before try to trigger a read(...) or write(...) as otherwise
        // the NIO JDK channel implementation may throw a NotYetConnectedException.
        //判断这个事件的具体是哪个。
        // 判断是否是OP_CONNECT事件。
        if ((readyOps & SelectionKey.OP_CONNECT) != 0) {
            // remove OP_CONNECT as otherwise Selector.select(..) will always return without blocking
            // See https://github.com/netty/netty/issues/924
            int ops = k.interestOps();
            ops &= ~SelectionKey.OP_CONNECT;
            k.interestOps(ops);

            unsafe.finishConnect();
        }

        // Process OP_WRITE first as we may be able to write some queued buffers and so free memory.
        // 判断是否是OP_WRITE事件。
        if ((readyOps & SelectionKey.OP_WRITE) != 0) {
            // Call forceFlush which will also take care of clear the OP_WRITE once there is nothing left to write
            ch.unsafe().forceFlush();
        }

        // Also check for readOps of 0 to workaround possible JDK bug which may otherwise lead
        // to a spin loop
        // 判断是否是OP_READ或者OP_ACCEPT事件。
        if ((readyOps & (SelectionKey.OP_READ | SelectionKey.OP_ACCEPT)) != 0 || readyOps == 0) {
            unsafe.read();
            if (!ch.isOpen()) {
                // Connection already closed - no need to handle write.
                return;
            }
        }
    } catch (CancelledKeyException ignored) {
        unsafe.close(unsafe.voidPromise());
    }
}
```

到这里我们就看到了netty是如何进行IO检测的，我们梳理一下流程。首先我们通过select进行获取IO事件，当然这里并不只有IO事件，还有外部线程的打断、任务队列和定时任务队列中存在任务，都会打断select的轮询，然后我们遍历这个selector上的SelectionKey，判断当前的IO事件，这样我就检测到了IO事件。并且通过pipeline进行处理这些IO事件。

## runTask 执行队列任务

这里就到了我们NioEventLoop的最后一个流程：执行任务队列和定时任务队列里面的任务。我们先梳理一下大概的流程。在NioEventLoop中提供了接口，用于添加和删除普通任务和定时任务，然后将定时任务与普通任务进行合并，然后进行执行俩种任务。

### 任务的添加

我们上面说了，任务分为俩种，一种是普通任务，一种是定时任务，其实我们分析过了，在NioEventLoop构造函数中，就创建了taskQueue。我们一起来看看吧：

```java
// NioEventLoop.java
NioEventLoop(NioEventLoopGroup parent, Executor executor, SelectorProvider selectorProvider,
             SelectStrategy strategy, RejectedExecutionHandler rejectedExecutionHandler) {
    // 进入父类构造方法中。
    super(parent, executor, false, DEFAULT_MAX_PENDING_TASKS, rejectedExecutionHandler);
    if (selectorProvider == null) {
        throw new NullPointerException("selectorProvider");
    }
    if (strategy == null) {
        throw new NullPointerException("selectStrategy");
    }
    provider = selectorProvider;
    selector = openSelector();
    selectStrategy = strategy;
}
// SingleThreadEventLoop.java
protected SingleThreadEventLoop(EventLoopGroup parent, Executor executor,
                                boolean addTaskWakesUp, int maxPendingTasks,
                                RejectedExecutionHandler rejectedExecutionHandler) {
    // 继续跟进去
    super(parent, executor, addTaskWakesUp, maxPendingTasks, rejectedExecutionHandler);
    tailTasks = newTaskQueue(maxPendingTasks);
}

//SingleThreadEventExecutor.java
protected SingleThreadEventExecutor(EventExecutorGroup parent, Executor executor,
                                    boolean addTaskWakesUp, int maxPendingTasks,
                                    RejectedExecutionHandler rejectedHandler) {
    super(parent);
    this.addTaskWakesUp = addTaskWakesUp;
    this.maxPendingTasks = Math.max(16, maxPendingTasks);
    this.executor = ObjectUtil.checkNotNull(executor, "executor");
    // 这里调用PlatformDependent.newMpscQueue(maxPendingTasks);进行创建一个MpscQueue,这里我们之前讲解过了。
    taskQueue = newTaskQueue(this.maxPendingTasks);
    rejectedExecutionHandler = ObjectUtil.checkNotNull(rejectedHandler, "rejectedHandler");
}
// 然后在外部线程调用NioEventLoop的execute方法时：
//SingleThreadEventExecutor.java
@Override
public void execute(Runnable task) {
    if (task == null) {
        throw new NullPointerException("task");
    }

    boolean inEventLoop = inEventLoop();
    if (inEventLoop) {
        addTask(task);
    } else {
        //这里startThread我们之前就分析过了。
        startThread();
        // 我们仔细来查看这个addTask(task)
        addTask(task);
        if (isShutdown() && removeTask(task)) {
            reject();
        }
    }

    if (!addTaskWakesUp && wakesUpForTask(task)) {
        wakeup(inEventLoop);
    }
}
//SingleThreadEventExecutor.java
protected void addTask(Runnable task) {
    if (task == null) {
        throw new NullPointerException("task");
    }
    //这里调用了offerTask，那么其实就是往taskQueue中添加一个任务。这里就是对普通任务的添加。
    if (!offerTask(task)) {
        reject(task);
    }
}
final boolean offerTask(Runnable task) {
    if (isShutdown()) {
        reject();
    }
    return taskQueue.offer(task);
}
```

分析了普通任务的添加，我们来查看定时任务的添加，如果你是用过netty的定时任务，那么你应该知道，这个入口就在NioEventLoop的`schedule();`方法，这个方法在`AbstractScheduledEventExecutor`类中，它是NioEventLoop的一个父类。 我们来看看这个方法的实现：

```java
// AbstractScheduledEventExecutor.java
@Override
public  ScheduledFuture<?> schedule(Runnable command, long delay, TimeUnit unit) {
    ObjectUtil.checkNotNull(command, "command");
    ObjectUtil.checkNotNull(unit, "unit");
    if (delay < 0) {
        throw new IllegalArgumentException(
            String.format("delay: %d (expected: >= 0)", delay));
    }
    // 这里将callable 封装成netty自己的一个FutureTask。
    return schedule(new ScheduledFutureTask<Void>(
        this, command, null, ScheduledFutureTask.deadlineNanos(unit.toNanos(delay))));
}
// 这里就是讲定时任务添加到定时任务队列中。
<V> ScheduledFuture<V> schedule(final ScheduledFutureTask<V> task) {
    // 首先判断调用这个schedule方法的线程是不是一个NioEventLoop线程。
    // 如果是的话，那么就直接讲task添加到定时任务队列中，否则就把添加定时任务也当做一个普通任务来进行，
    // 因为这个定时任务队列它并不是线程安全的。因为NioEventLoop与线程是一对一的关系，
    // 所以放在EventLoop的线程中执行是一个单线程操作，这样就不会有线程安全问题。不仅仅是添加，所有关于
    // 定时任务队列相关的操作，都会放到NioEventLoop中去执行，用来保证线程安全。
    if (inEventLoop()) {
        scheduledTaskQueue().add(task);
    } else {
        execute(new Runnable() {
            @Override
            public void run() {
                scheduledTaskQueue().add(task);
            }
        });
    }
    return task;
}
```

我们上面分析了，定时任务的添加这一步骤，需要保证在NioEventLoop的线程中进行，为了保证其线程安全。如果不是在，那么把这个操作当成一个普通任务的形式，通过execute方法定时任务添加到定时任务队列中。那么到这里，我们分析了俩种定时任务的添加，下面我们来分析netty怎么去把这俩种任务聚合在一起。

### 俩种任务的聚合与执行

还记得netty在执行处理IO事件前，记录了当前时间戳，我们一起来看看之前的代码吧：

```java
// NioEventLoop.java 中的run方法：
cancelledKeys = 0;
needsToSelectAgain = false;
//这个默认是50
final int ioRatio = this.ioRatio;
if (ioRatio == 100) {
    try {
        processSelectedKeys();
    } finally {
        // Ensure we always run tasks.
        runAllTasks();
    }
} else {
    // 这里记录了一个开始时间
    final long ioStartTime = System.nanoTime();
    try {
        //执行处理IO事件
        processSelectedKeys();
    } finally {
        // Ensure we always run tasks.
        // 获取处理IO事件花费的时间。
        final long ioTime = System.nanoTime() - ioStartTime;
        // 这里表示，执行任务的时间不能超过 ioTime * (100 - ioRatio) / ioRatio 
        runAllTasks(ioTime * (100 - ioRatio) / ioRatio);
    }
}

// SingleThreadEventExecutor.java
// 任务的聚合。
private boolean fetchFromScheduledTaskQueue() {
    // 这里从定时任务队列中获取第一个任务。这个定时任务列队是根据优先级来的，
    // 因为这个定时任务队列，要么就是可以传入元素对应的比较器，要么就是这个元素本身实现了比较器。
    // 你可以去查看一下这个队列源码，其实很简单。比较规则在ScheduledFutureTask中的compareTo方法，
    // 具体的比较规则就是先比较截止时间，截止时间小的的在前面，
    // 截止时间小的在后面，如果截止时间相同，那么就比较id，id小的在前面，id大的在后面，如果相同，就抛异常。
    long nanoTime = AbstractScheduledEventExecutor.nanoTime();
    Runnable scheduledTask  = pollScheduledTask(nanoTime);
    // 这里就比较好理解了，循环取出定时任务，往taskQueue中添加。
    while (scheduledTask != null) {
        if (!taskQueue.offer(scheduledTask)) {
            // No space left in the task queue add it back to the scheduledTaskQueue so we pick it up again.
            scheduledTaskQueue().add((ScheduledFutureTask<?>) scheduledTask);
            return false;
        }
        scheduledTask  = pollScheduledTask(nanoTime);
    }
    return true;
}

// AbstractEventExecutor.java
protected static void safeExecute(Runnable task) {
    try {
        // 这里直接去执行run方法。出现异常也并没有做过多处理，只是将异常信息打印出来。
        // 异常内部消化了，所以即使某个任务出现了异常，也会保证后续任务不会受到干扰，
        // 能正常的执行下去。
        task.run();
    } catch (Throwable t) {
        logger.warn("A task raised an exception. Task: {}", task, t);
    }
}
//SingleThreadEventExecutor.java
 protected boolean runAllTasks(long timeoutNanos) {
     // 这里就是任务的聚合
     fetchFromScheduledTaskQueue();
     Runnable task = pollTask();
     if (task == null) {
         afterRunningAllTasks();
         return false;
     }
     // 计算出超时时间
     final long deadline = ScheduledFutureTask.nanoTime() + timeoutNanos;
     long runTasks = 0;
     long lastExecutionTime;
     // 然后循环去执行任务。
     for (;;) {
         safeExecute(task);
         runTasks ++;
         // Check timeout every 64 tasks because nanoTime() is relatively expensive.
         // XXX: Hard-coded value - will make it configurable if it is really a problem.
         // 当任务执行到64次的时候，就去判断是否超时，这里为啥要等64次呢，上面也解释了，
         // 因为这个nanoTime他也是一个耗时操作，如果每次执行完都检测，那么将影响效率。
         // 其实这里的超时时间并不保证执行时间必须要小于这个超时时间，只是尽可能的保证不超过超市时间。
         if ((runTasks & 0x3F) == 0) {
             lastExecutionTime = ScheduledFutureTask.nanoTime();
             if (lastExecutionTime >= deadline) {
                 break;
             }
         }
         // 重新从任务队列中拿到这个任务。
         task = pollTask();
         // 如果队列里面没有任务了， 那么就记录当前时间，赋值给最后执行时间变量。
         if (task == null) {
             lastExecutionTime = ScheduledFutureTask.nanoTime();
             break;
         }
     }
     // 然后任务执行后续操作。
     afterRunningAllTasks();
     this.lastExecutionTime = lastExecutionTime;
     return true;
}
```

那么到这里，我们就分析了俩种任务的合并与执行。我们来总结一下这个流程netty做了什么事情吧~

首先，在netty调用自己的`select()`方法后，会去执行`runTask();`方法，执行任务队列中的任务，这一步又细分了俩个步骤，第一步，是将俩种任务进行合并，遍历定时任务队列，将定时任务添加到普通任务队列中。添加完成后，根据处理IO时间的时间，然后做一个计算，得出他的一个任务队列执行的一个超时时间，也就是在执行这些任务期间，尽可能不能超过这个超时时间，每过64次去检测一次，至于为啥不是每次去检测一次，因为`ScheduledFutureTask.nanoTime();`这个方法是一个比较耗时操作，所以不应该每次执行完一个任务就去检测。执行完后，会去记录最后的一个截止时间。

## 总结

到这里我们就分析完了NioEventLoop一些流程，比如从我们的NioEventLoop的创建，到启动，然后从NioEventLoop怎么去检测与处理IO事件、执行任务队列。这一篇文章的知识点很多，也需要我们自己多动手，仔细跟踪一下源码，进行巩固。

那么我们前面的三个问题通过这篇文章就可以进行解答了。

第一个，默认创建的是CPU核数*2的线程个数。在我们调用execute方法时，先去判断线程是否开启，如果没有开启，那么就去创建一个新的线程，如果开启了，那么就将当前的任务添加到任务队列中等待去执行。

第二个问题，netty是如何解决java nio 空轮训的BUG的。首先出现空轮训的bug的原因，就是当前这个selector出现了问题，可能是网络连接发生了故障，比如出现了RST，然后底层就会触发网络中断，从而唤醒阻塞的java线程，也就是java  nio  的阻塞select，但是返回的标识位还是0，跟正常模式一样，这就导致了用户程序无法判断到底是没有IO事件还是因为发生了RST，所以一般我们是select返回值不为0，我们才结束轮训select，否则就继续轮训select，如果发生了RST，那么此时的select并不是一个阻塞的了，他会立马返回，因为它一调用底层的poll 或者epoll方法，就会立马触发网络中断，从而返回，这样就代码就等价于`while(true){}` 从而造成了空轮训，导致CPU飙升100%。然后netty的解决办法也很巧妙，因为它对select有时间限制，所以它最多阻塞timeoutMillis，本来要阻塞这么久，但是如果我发现它并没有阻塞这么久，并且这种情况达到了一定次数，那么netty就认为这个连接可能出现了问题，也就是这个selector出现了问题，那么就把这个selector上的东西重新注册到一个新的selector上，这样就可以避免空轮训的出现。

第三个问题，netty就是在执行任务的时候，首先判断是否是在NioEventLoop的内部线程中，如果不是，那么就把任务封装成一个netty自己的task，然后丢到任务队列中，等待select执行结束，就会去执行这个任务队列。

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

