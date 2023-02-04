---
title: 玩转微服务前戏01 安装虚拟机及docker
date: 2023-01-02 20:59:02
tags:
  - docker
categories:
  - docker
  - 微服务
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

<!--more-->

# 安装虚拟机

我们这里使用的是 `Vmware` ,下载和安装就不细说了。这里如果安装后遇到网络问题，可以详细看下这篇博客：[**`vmware`虚拟机网络配置详解**](https://blog.51cto.com/u_15169172/2710721)，这篇博客详细介绍了三者的区别与设置方法。

## 设置 Vmware开机自启虚拟机

如果你不想每次开启电脑都需要手动开启 vmware 并且还要手动开启虚拟机，那么你可以使用windows的组策略来实现。[传送门](https://zhuanlan.zhihu.com/p/365467417)

## 设置docker 及其容器自启

### docker 自启

```shell
# 输入以下命令，非root用户在命令前添加sudo
systemctl enable docker
```

###  docker 容器自启

docker容器自启动其实就是在启动容器的时候，添加一个选项即可

```shell
docker run -d --restart=always --name 设置容器名 使用的镜像
（上面命令  --name后面两个参数根据实际情况自行修改）
 
# Docker 容器的重启策略如下：
 --restart具体参数值详细信息：
       no　　　　　　　 // 默认策略,容器退出时不重启容器；
       on-failure　　  // 在容器非正常退出时（退出状态非0）才重新启动容器；
       on-failure:3    // 在容器非正常退出时重启容器，最多重启3次；
       always　　　　  // 无论退出状态是如何，都重启容器；
       unless-stopped  // 在容器退出时总是重启容器，但是不考虑在 Docker 守护进程启动时就已经停止了的容器。
```

如果你的容器正在运行，那么可以通过`update` 命令来进行更新：

```shell
docker update --restart=always 容器ID(或者容器名)
```

# 更新docker 源

我们在使用`docker pull`镜像时，可能有因为网络的问题（下载失败、下载非常慢等）。这个时候我们就可以将docker的镜像源设置为国内的。

1. 修改 `daemon.json` 配置文件

   命令：` vi /etc/docker/daemon.json` 。如果docker目录不存在，自行创建即可：`sudo mkdir -p /etc/docker`。然后将下面内容粘贴到打开的文件中。

   ``````json
   {
     "registry-mirrors": ["https://registry.docker-cn.com"]
   }
   ``````

   保存退出。

2. 重载守护进程文件，重启 docker

```shell
sudo systemctl daemon-reload
sudo systemctl restart docker
```

3. 查看信息

```shell
docker info
# 如果出现下面这个信息，说明修改成功
...
Registry Mirrors:
 https://registry.docker-cn.com
...
```

# 开启Docker Remote Api

> 为了方便操作docker 镜像与容器，我们可以用一些三方的可视化工具，可以很方便的提高我们的效率，我这里使用 Portainer 社区版。

 我们首先需要修改一下开机自启docker的启动参数。

```shell
# 如果提示vim不存在，使用vi命令也可
vim /usr/lib/systemd/system/docker.service
```

在 ExecStart=/usr/bin/dockerd 后面直接添加 -H tcp://0.0.0.0:2375-H unix:///var/run/docker.sock （注意端口2375自己随便定义，别跟当前的冲突即可）

# 安装Portainer 社区版

我们可以使用Portainer官网的教程，一步一步操作即可。

1. 创建数据存储的卷(volume)

   ```shell
   docker volume create portainer_data
   ```

2. 可以下载并且安装Portainer Server 容器

   这里如果你不是企业所用，直接安装社区版，也就是portainer-ce

   ```shell
   docker run -d -p 8000:8000 -p 9443:9443 --name portainer --restart=always -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:latest
   ```

然后使用`docker ps`命令，即可查看到 portainer 的容器已经启动了。

打开浏览器输入https://ip:9443 。然后使用的话可以直接百度or谷歌了~

# 安装微服务相关组件

## 安装nacos

