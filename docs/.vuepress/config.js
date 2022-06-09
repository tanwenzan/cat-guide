module.exports = {
	port: "80",
	dest: ".site",
	base: "/",
	// 是否开启默认预加载js
	shouldPrefetch: (file, type) => {
		return false;
	},
	// webpack 配置 https://vuepress.vuejs.org/zh/config/#chainwebpack
	chainWebpack: config => {
		if (process.env.NODE_ENV === 'production') {
			const dateTime = new Date().getTime();

			// 清除js版本号
			config.output.filename('assets/js/cg-[name].js?v=' + dateTime).end();
			config.output.chunkFilename('assets/js/cg-[name].js?v=' + dateTime).end();

			// 清除css版本号
			config.plugin('mini-css-extract-plugin').use(require('mini-css-extract-plugin'), [{
				filename: 'assets/css/[name].css?v=' + dateTime,
				chunkFilename: 'assets/css/[name].css?v=' + dateTime
			}]).end();

		}
	},
	markdown: {
		lineNumbers: true,
		externalLinks: {
			target: '_blank',
			rel: 'noopener noreferrer'
		}
	},
	locales: {
		"/": {
			lang: "zh-CN",
			title: "小谭充电屋",
			description: "忙碌的工作和生活的琐事也不要忘机给自己充充电~🔋"
		}
	},
	head: [
		// ico
		["link", {
			rel: "icon",
			href: `/web-icon.svg`
		}],
		// meta
		["meta", {
			name: "robots",
			content: "all"
		}],
		["meta", {
			name: "author",
			content: "zeroable"
		}],
		["meta", {
			"http-equiv": "Cache-Control",
			content: "no-cache, no-store, must-revalidate"
		}],
		["meta", {
			"http-equiv": "Pragma",
			content: "no-cache"
		}],
		["meta", {
			"http-equiv": "Expires",
			content: "0"
		}],
		["meta", {
			name: "keywords",
			content: "小谭，小谭充电屋, 编程语言，开发技术，MySQL，JVM技术，MySQL，框架源码。。。"
		}],
		["meta", {
			name: "apple-mobile-web-app-capable",
			content: "yes"
		}],
		['script',
			{
				charset: 'utf-8',
				async: 'async',
				// src: 'https://code.jquery.com/jquery-3.5.1.min.js',
				src: '/js/jquery.min.js',
			}
		],
		['script',
			{
				charset: 'utf-8',
				async: 'async',
				// src: 'https://code.jquery.com/jquery-3.5.1.min.js',
				src: '/js/global.js',
			}
		],
		['script',
			{
				charset: 'utf-8',
				async: 'async',
				src: '/js/fingerprint2.min.js',
			}
		],
		//github: binghe001.github.io
		['script',
			{
				charset: 'utf-8',
				async: 'async',
				src: 'https://v1.cnzz.com/z_stat.php?id=1281063564&web_id=1281063564',
			}
		],
		//gitee: binghe001.gitee.io
		['script',
			{
				charset: 'utf-8',
				async: 'async',
				src: 'https://s9.cnzz.com/z_stat.php?id=1281064551&web_id=1281064551',
			}
		],
		// 添加百度统计
		["script", {},
			`
            var _hmt = _hmt || [];
            (function() {
              var hm = document.createElement("script");
              hm.src = "https://hm.baidu.com/hm.js?cc6f75b8aeeb7fda09379b23f1ae1bc3";
              var s = document.getElementsByTagName("script")[0];
              s.parentNode.insertBefore(hm, s);
            })();
            `
		]
	],
	plugins: [
		[{
			globalUIComponents: ['LockArticle', 'PayArticle']
		}],
		['@vuepress/medium-zoom', {
			selector: 'img:not(.nozoom)',
			// See: https://github.com/francoischalifour/medium-zoom#options
			options: {
				margin: 16
			}
		}],
		['vuepress-plugin-baidu-autopush', {}],
		// see: https://github.com/znicholasbrown/vuepress-plugin-code-copy
		['vuepress-plugin-code-copy', {
			align: 'bottom',
			color: '#3eaf7c',
			successText: '@小谭: 代码已经复制到剪贴板'
		}],
		// see: https://github.com/tolking/vuepress-plugin-img-lazy
		['img-lazy', {}],
		["vuepress-plugin-tags", {
			type: 'default', // 标签预定义样式
			color: '#42b983', // 标签字体颜色
			border: '1px solid #e2faef', // 标签边框颜色
			backgroundColor: '#f0faf5', // 标签背景颜色
			selector: '.page .content__default h1' // ^v1.0.1 你要将此标签渲染挂载到哪个元素后面？默认是第一个 H1 标签后面；
		}],
		// https://github.com/lorisleiva/vuepress-plugin-seo
		["seo", {
			siteTitle: (_, $site) => $site.title,
			title: $page => $page.title,
			description: $page => $page.frontmatter.description,
			author: (_, $site) => $site.themeConfig.author,
			tags: $page => $page.frontmatter.tags,
			// twitterCard: _ => 'summary_large_image',
			type: $page => 'article',
			url: (_, $site, path) => ($site.themeConfig.domain || '') + path,
			image: ($page, $site) => $page.frontmatter.image && (($site.themeConfig.domain && !$page
				.frontmatter.image.startsWith('http') || '') + $page.frontmatter.image),
			publishedAt: $page => $page.frontmatter.date && new Date($page.frontmatter.date),
			modifiedAt: $page => $page.lastUpdated && new Date($page.lastUpdated),
		}]
	],
	themeConfig: {
		docsRepo: "tanwenzan/cat-guide",
		// 编辑文档的所在目录
		docsDir: 'docs',
		// 文档放在一个特定的分支下：
		docsBranch: 'master',
		logo: "/web-icon.svg",
		editLinks: true,
		sidebarDepth: 0,
		//smoothScroll: true,
		locales: {
			"/": {
				label: "简体中文",
				selectText: "Languages",
				editLinkText: "在 GitHub 上编辑此页",
				lastUpdated: "上次更新",
				nav: [{
						text: '导读',
						link: '/md/other/guide-to-reading'
					},
					{
						text:'程序人生',
						link:'/md/code-life/default.md'
					},
					{
						text: '关于',
						items: [{
								text: '关于自己',
								link: '/md/about/me/about-me.md'
							},
							{
								text: '关于学习',
								link: '/md/about/study/default.md'
							},
							{
								text: '关于职场',
								link: '/md/about/job/default.md'
							}
						]
					},
					{
						text: 'CSDN',
						link: 'https://blog.csdn.net/qq_36707152'
					},
					{
						text: '知乎',
						link: 'https://www.zhihu.com/people/zeroable'
					},
					{
						text: 'Github',
						link: 'https://github.com/tanwenzan/cat-guide'
					}
				],
				sidebar: {
					"/md/other/": genBarOther(),
				}
			}
		}
	}
};

// other
function genBarOther() {
	return [{
		title: "阅读指南",
		collapsable: false,
		sidebarDepth: 2,
		children: [
			"guide-to-reading.md"
		]
	}]
}