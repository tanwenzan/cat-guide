---
title: netty源码解析04-pipeline详解
date: 2021-11-18 15:00:00
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

> 提示:如果没有听过或者使用过`java nio` 和`netty`，不建议直接阅读此文章，建议先去了解`java nio` 和`netty`之后再阅读此文章。

<!--more-->

# pipeline详解

## 前言

上一篇文章，我们知道了新连接做了哪些事情，包括从服务端重新注册`interestOps`开始真正监听新连接事件，然后到新连接的处理，包括从新连接的初步注册，再到新连接重新注册`interestOps`。从服务端启动、分析`NioEventLoop`、到上一篇文章的新连接接入流程，`pipeline`无处不在，在`netty`中也非常重要，我们今天就来分析这个`pipeline`到底是个什么东西，从它的数据结构，到它的创建、初始化、还有添加各种`handler`，`netty`到底是怎么做的，以及为啥要这样子做？

## pipeline的结构

首先我们来看一下pipeline在哪里用到了，我们从用户代码`ch.pipeline().addLast(xxx);`中知道，是在`channel`中持有`pipeline`的一个引用。我们进入`AbstractChannel`就可以发现有一个`pipeline`属性，类型就是`DefaultChannelPipeline`，这样就意味着，`channel`与`pipeline`是一对一的。

### pipeline类关系

我们可以查看这个`DefaultChannelPipeline`的结构。我们首先来查看一下类的关系：

![](https://img.zeroable.cn/202204081424996.png)
首先，我们可以看到最主要的`DefaultChannelPipeline`，它的父类接口有三个，分别是`ChannelPipeline`、`ChannelOutboundInvoker`、`ChannelInboundInvoker`。其中`ChannelPipeline`继承了其他俩个接口，我们来查看一下：

> A list of link ChannelHandlers which handles or intercepts inbound events and outbound operations of a Channel.
> 一种处理或拦截通道的入站事件和出站操作的通道处理程序的列表。

通过这个，我们能大致了解到这个`pipeline`是啥。首先，它存储着一些`handler`的列表，然后它能维护这个列表，最后，它能有序的去调用这些`handler`进行处理相关的事件。

### pipeline 相关方法

我们再来看看这个`ChannelPipeline`有哪些方法。它的方法主要分为俩类，一类用于维护这个`handler`列表，一类用于执行这些`handler`的相关事件。我们先来看看维护这个`handler`相关列表的方法有哪些：

![](https://img.zeroable.cn/202204081425157.png)


我们可以通过上面的方法就能大致知道这个列表其实是一个双向链表结构，跟`LinkedList`差不多，分别有`头插法`和`尾插法`，分别对应里面的`addFirst`和`addLast`方法。

我们再来看看操作相关的方法：

![](https://img.zeroable.cn/202204081426080.png)


看到这些方法，是不是很熟悉，在前面我们分析服务端启动、`NioEventLoop`详解、新连接接入这些流程的时候，能看到很多地方都能使用了`pipeline.firexxx();`。最终还是调用了`handler`的相关方法。

### pipeline执行流程

我们再来看看它的一个流程：
![](https://img.zeroable.cn/202204081426246.png)



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

