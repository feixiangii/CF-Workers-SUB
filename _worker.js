
// 部署完成后在网址后面加上这个，获取自建节点和机场聚合节点，/?token=auto或/auto或

// ===== 常量 =====
const KV_BODY_LIMIT = 1048576; // 1MB - KV POST body 最大长度（KV 单值最大 25MB）
const SUB_FETCH_TIMEOUT = 5000; // 5秒 - 订阅源请求超时
const DEFAULT_TOKEN = 'auto';
const DEFAULT_SUB_CONVERTER = "SUBAPI.cmliussss.net";
const DEFAULT_SUB_CONFIG = "https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini";
const DEFAULT_FILE_NAME = 'CF-Workers-SUB';
const DEFAULT_SUB_UPDATE_TIME = 6; // 自定义订阅更新时间，单位小时
const TOTAL_TB = 99; // TB
const EXPIRE_TIMESTAMP = 4102329600000; // 2099-12-31

const NGINX_PAGE = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
	body {
		width: 35em;
		margin: 0 auto;
		font-family: Tahoma, Verdana, Arial, sans-serif;
	}
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;

const SECURITY_HEADERS = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

// ===== 默认数据 =====
const DEFAULT_MAIN_DATA = `
https://cfxr.eu.org/getSub
`;

// ===== 工具函数 =====

function isPrivateIP(hostname) {
	// 检测 IPv4 私有/保留地址
	const parts = hostname.split('.');
	if (parts.length === 4) {
		const [a, b] = parts.map(Number);
		if (!isNaN(a) && !isNaN(b)) {
			return (a === 10) ||
				(a === 172 && b >= 16 && b <= 31) ||
				(a === 192 && b === 168) ||
				(a === 127) ||
				(a === 0);
		}
	}
	// 检测 IPv6 回环和内网
	const lower = hostname.toLowerCase();
	return lower === '::1' || lower === 'localhost' || lower.startsWith('fc') || lower.startsWith('fd') || lower === '[::1]';
}

function escapeHtml(str) {
	if (!str) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function encodeBase64(data) {
	const binary = new TextEncoder().encode(data);
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	let base64 = '';

	for (let i = 0; i < binary.length; i += 3) {
		const byte1 = binary[i];
		const byte2 = binary[i + 1] || 0;
		const byte3 = binary[i + 2] || 0;

		base64 += chars[byte1 >> 2];
		base64 += chars[((byte1 & 3) << 4) | (byte2 >> 4)];
		base64 += chars[((byte2 & 15) << 2) | (byte3 >> 6)];
		base64 += chars[byte3 & 63];
	}

	const padding = 3 - (binary.length % 3 || 3);
	return base64.slice(0, base64.length - padding) + '=='.slice(0, padding);
}

// 统一订阅格式检测：URL 参数优先，然后 UA 检测
function detectSubFormat(userAgent, urlSearchParams, isSubConverterRequest) {
	// URL 参数优先
	if (urlSearchParams.has('b64') || urlSearchParams.has('base64')) return 'base64';
	if (urlSearchParams.has('clash')) return 'clash';
	if (urlSearchParams.has('singbox') || urlSearchParams.has('sb')) return 'singbox';
	if (urlSearchParams.has('surge')) return 'surge';
	if (urlSearchParams.has('quanx')) return 'quanx';
	if (urlSearchParams.has('loon')) return 'loon';

	// 默认格式不走 UA 检测
	if (userAgent.includes('null') || isSubConverterRequest ||
		userAgent.includes('nekobox') || userAgent.includes(DEFAULT_FILE_NAME.toLowerCase())) {
		return 'base64';
	}

	// UA 检测
	if (userAgent.includes('sing-box') || userAgent.includes('singbox')) return 'singbox';
	if (userAgent.includes('surge')) return 'surge';
	if (userAgent.includes('quantumult')) return 'quanx';
	if (userAgent.includes('loon')) return 'loon';
	if (userAgent.includes('clash') || userAgent.includes('meta') || userAgent.includes('mihomo')) return 'clash';

	return 'base64';
}

// 根据 URL 参数获取追加 UA（用于订阅转换后端请求）
function getUpstreamUA(urlSearchParams) {
	if (urlSearchParams.has('b64') || urlSearchParams.has('base64')) return 'v2rayn';
	if (urlSearchParams.has('clash')) return 'clash';
	if (urlSearchParams.has('singbox') || urlSearchParams.has('sb')) return 'singbox';
	if (urlSearchParams.has('surge')) return 'surge';
	if (urlSearchParams.has('quanx')) return 'Quantumult%20X';
	if (urlSearchParams.has('loon')) return 'Loon';
	return 'v2rayn';
}

// 合并安全头到自定义响应头
function withSecurityHeaders(headers) {
	return { ...SECURITY_HEADERS, ...headers };
}

// ===== 主入口 =====
export default {
	async fetch(request, env, ctx) {
		// --- 所有变量均为局部 const/let，避免并发竞态 ---
		const userAgentHeader = request.headers.get('User-Agent');
		const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : "null";
		const url = new URL(request.url);
		const token = url.searchParams.get('token');

		const mytoken = env.TOKEN || DEFAULT_TOKEN;
		let BotToken = env.TGTOKEN || '';
		let ChatID = env.TGID || '';
		const TG = env.TG || 0;

		let subConverter = env.SUBAPI || DEFAULT_SUB_CONVERTER;
		let subProtocol = 'https';
		if (subConverter.includes("http://")) {
			subConverter = subConverter.split("//")[1];
			subProtocol = 'http';
		} else {
			subConverter = subConverter.split("//")[1] || subConverter;
		}

		let subConfig = env.SUBCONFIG || DEFAULT_SUB_CONFIG;
		let FileName = env.SUBNAME || DEFAULT_FILE_NAME;
		const SUBUpdateTime = env.SUBUPTIME || DEFAULT_SUB_UPDATE_TIME;

		let MainData = DEFAULT_MAIN_DATA;
		let urls = [];

		const currentDate = new Date();
		currentDate.setHours(0, 0, 0, 0);
		const timeTemp = Math.ceil(currentDate.getTime() / 1000);
		const fakeToken = await MD5MD5(`${mytoken}${timeTemp}`);
		let guestToken = env.GUESTTOKEN || env.GUEST || '';
		if (!guestToken) guestToken = await MD5MD5(mytoken);
		const guestSubToken = guestToken;

		let UD = Math.floor(((EXPIRE_TIMESTAMP - Date.now()) / EXPIRE_TIMESTAMP * TOTAL_TB * 1099511627776) / 2);
		const total = TOTAL_TB * 1099511627776;
		const expire = Math.floor(EXPIRE_TIMESTAMP / 1000);

		// --- Token 验证 ---
		const isTokenValid = [mytoken, fakeToken, guestSubToken].includes(token) ||
			url.pathname == ("/" + mytoken);

		if (!isTokenValid) {
			if (TG == 1 && url.pathname !== "/" && url.pathname !== "/favicon.ico") {
				ctx.waitUntil(sendMessage(BotToken, ChatID, `#异常访问 ${FileName}`, request.headers.get('CF-Connecting-IP'), `UA: ${userAgentHeader}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`));
			}
			if (env.URL302) return Response.redirect(env.URL302, 302);
			else if (env.URL) return await proxyURL(env.URL, url);
			else return new Response(await nginx(), {
				status: 200,
				headers: withSecurityHeaders({
					'Content-Type': 'text/html; charset=UTF-8',
				}),
			});
		}

		// --- Token 有效，处理订阅 ---
		if (env.KV) {
			await 迁移地址列表(env, 'LINK.txt');
			if (userAgent.includes('mozilla') && !url.search) {
				ctx.waitUntil(sendMessage(BotToken, ChatID, `#编辑订阅 ${FileName}`, request.headers.get('CF-Connecting-IP'), `UA: ${userAgentHeader}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`));
				return await KV(request, env, 'LINK.txt', guestSubToken, mytoken, subProtocol, subConverter, subConfig, FileName, BotToken, ChatID);
			} else {
				MainData = await env.KV.get('LINK.txt') || MainData;
			}
		} else {
			MainData = env.LINK || MainData;
			if (env.LINKSUB) urls = ADD(env.LINKSUB);
		}

		let allLinks = ADD(MainData + '\n' + urls.join('\n'));
		let selfNodes = "";
		let subLinks = "";
		for (const x of allLinks) {
			if (x.toLowerCase().startsWith('http')) {
				subLinks += x + '\n';
			} else {
				selfNodes += x + '\n';
			}
		}
		MainData = selfNodes;
		urls = ADD(subLinks);

		ctx.waitUntil(sendMessage(BotToken, ChatID, `#获取订阅 ${FileName}`, request.headers.get('CF-Connecting-IP'), `UA: ${userAgentHeader}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`));

		// --- 订阅格式检测（统一逻辑） ---
		const isSubConverterRequest = request.headers.get('subconverter-request') ||
			request.headers.get('subconverter-version') ||
			userAgent.includes('subconverter');
		const subFormat = detectSubFormat(userAgent, url.searchParams, isSubConverterRequest);
		const upstreamUA = getUpstreamUA(url.searchParams);

		let subConverterUrl;
		let 订阅转换URL = `${url.origin}/${await MD5MD5(fakeToken)}?token=${fakeToken}`;
		let req_data = MainData;

		const uniqueSubLinks = [...new Set(urls)].filter(item => item?.trim?.());
		if (uniqueSubLinks.length > 0) {
			const [subContent, subConvertURLs] = await getSUB(uniqueSubLinks, request, upstreamUA, userAgentHeader);
			console.log(subContent);
			req_data += subContent.join('\n');
			订阅转换URL += "|" + subConvertURLs;
			if (subFormat == 'base64' && !isSubConverterRequest && subConvertURLs.includes('://')) {
				subConverterUrl = `${subProtocol}://${subConverter}/sub?target=mixed&url=${encodeURIComponent(subConvertURLs)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
				try {
					const subConverterResponse = await fetch(subConverterUrl, {
						headers: { 'User-Agent': 'v2rayN/CF-Workers-SUB  (https://github.com/cmliu/CF-Workers-SUB)' }
					});
					if (subConverterResponse.ok) {
				const subConverterContent = await subConverterResponse.text();
					if (isValidBase64(subConverterContent)) {
						req_data += '\n' + base64Decode(subConverterContent);
					}
					}
				} catch (error) {
					console.log('订阅转换回base64失败，检查订阅转换后端是否正常运行');
				}
			}
		}

		if (env.WARP) 订阅转换URL += "|" + ADD(env.WARP).join("|");

		// 去重（移除了无用的 UTF-8 编解码步骤）
	const uniqueLines = new Set(req_data.split('\n').map(line => line.trim()).filter(Boolean));
	const result = [...uniqueLines].join('\n');

		// 统一 Base64 编码
		const base64Data = encodeBase64(result);

		// 构建响应头
		const responseHeaders = withSecurityHeaders({
			"content-type": "text/plain; charset=utf-8",
			"Profile-Update-Interval": `${SUBUpdateTime}`,
			"Profile-web-page-url": request.url.includes('?') ? request.url.split('?')[0] : request.url,
			//"Subscription-Userinfo": `upload=${UD}; download=${UD}; total=${total}; expire=${expire}`,
		});

		if (subFormat == 'base64' || token == fakeToken) {
			return new Response(base64Data, { headers: responseHeaders });
		}

		// 构建订阅转换 URL
		const subTargetMap = {
			'clash': 'clash',
			'singbox': 'singbox',
			'surge': 'surge&ver=4',
			'quanx': 'quanx',
			'loon': 'loon',
		};
		const target = subTargetMap[subFormat];
		if (target) {
			const extraParams = subFormat === 'quanx' ? '&udp=true' : '';
			subConverterUrl = `${subProtocol}://${subConverter}/sub?target=${target}&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true${extraParams}`;
		}

		try {
			const subConverterResponse = await fetch(subConverterUrl, { headers: { 'User-Agent': userAgentHeader } });
			if (!subConverterResponse.ok) return new Response(base64Data, { headers: responseHeaders });
			let subConverterContent = await subConverterResponse.text();
			if (subFormat == 'clash') subConverterContent = await clashFix(subConverterContent);
			if (!userAgent.includes('mozilla')) responseHeaders["Content-Disposition"] = `attachment; filename*=utf-8''${encodeURIComponent(FileName)}`;
			return new Response(subConverterContent, { headers: responseHeaders });
		} catch (error) {
			return new Response(base64Data, { headers: responseHeaders });
		}
	}
};

// ===== 辅助函数 =====

function ADD(envadd) {
	let addtext = envadd.replace(/[	"'|\r\n]+/g, '\n').replace(/\n+/g, '\n');
	if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
	return addtext.split('\n');
}

async function nginx() {
	return NGINX_PAGE;
}

async function sendMessage(botToken, chatID, type, ip, add_data = "") {
	if (botToken !== '' && chatID !== '') {
		let msg = "";
		try {
			// 注意：ip-api.com 免费版仅支持 HTTP，生产环境建议使用支持 HTTPS 的 IP 查询服务
			const response = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`, {
				signal: AbortSignal.timeout(3000) // 3秒超时，防止拖慢主请求
			});
			if (response.status == 200) {
				const ipInfo = await response.json();
				msg = `${type}\nIP: ${ip}\n国家: ${ipInfo.country}\n<tg-spoiler>城市: ${ipInfo.city}\n组织: ${ipInfo.org}\nASN: ${ipInfo.as}\n${add_data}`;
			} else {
				msg = `${type}\nIP: ${ip}\n<tg-spoiler>${add_data}`;
			}
		} catch (e) {
			msg = `${type}\nIP: ${ip}\n<tg-spoiler>${add_data}`;
		}

		const tgUrl = "https://api.telegram.org/bot" + botToken + "/sendMessage?chat_id=" + chatID + "&parse_mode=HTML&text=" + encodeURIComponent(msg);
		return fetch(tgUrl, {
			method: 'get',
			headers: {
				'Accept': 'text/html,application/xhtml+xml,application/xml;',
				'Accept-Encoding': 'gzip, deflate, br',
				'User-Agent': 'Mozilla/5.0 Chrome/90.0.4430.72'
			}
		});
	}
}

function base64Decode(str) {
	const bytes = new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
	const decoder = new TextDecoder('utf-8');
	return decoder.decode(bytes);
}

async function MD5MD5(text) {
	const encoder = new TextEncoder();

	const firstPass = await crypto.subtle.digest('MD5', encoder.encode(text));
	const firstPassArray = Array.from(new Uint8Array(firstPass));
	const firstHex = firstPassArray.map(b => b.toString(16).padStart(2, '0')).join('');

	const secondPass = await crypto.subtle.digest('MD5', encoder.encode(firstHex.slice(7, 27)));
	const secondPassArray = Array.from(new Uint8Array(secondPass));
	const secondHex = secondPassArray.map(b => b.toString(16).padStart(2, '0')).join('');

	return secondHex.toLowerCase();
}

function clashFix(content) {
	if (content.includes('wireguard') && !content.includes('remote-dns-resolve')) {
		const lines = content.includes('\r\n') ? content.split('\r\n') : content.split('\n');
		let result = "";
		for (const line of lines) {
			if (line.includes('type: wireguard')) {
				const 备改内容 = `, mtu: 1280, udp: true`;
				const 正确内容 = `, mtu: 1280, remote-dns-resolve: true, udp: true`;
				result += line.replace(new RegExp(备改内容, 'g'), 正确内容) + '\n';
			} else {
				result += line + '\n';
			}
		}
		content = result;
	}
	return content;
}

async function proxyURL(proxyURLStr, url) {
	const URLs = ADD(proxyURLStr);
	const fullURL = URLs[Math.floor(Math.random() * URLs.length)];

	const parsedURL = new URL(fullURL);
	// SSRF 防护：禁止访问内网/保留地址
	if (isPrivateIP(parsedURL.hostname)) {
		return new Response("禁止访问内网地址", {
			status: 403,
			headers: withSecurityHeaders({ "Content-Type": "text/plain;charset=utf-8" })
		});
	}

	console.log(parsedURL);
	let URLProtocol = parsedURL.protocol.slice(0, -1) || 'https';
	const URLHostname = parsedURL.hostname;
	let URLPathname = parsedURL.pathname;
	const URLSearch = parsedURL.search;

	if (URLPathname.charAt(URLPathname.length - 1) == '/') {
		URLPathname = URLPathname.slice(0, -1);
	}
	URLPathname += url.pathname;

	const newURL = `${URLProtocol}://${URLHostname}${URLPathname}${URLSearch}`;
	const response = await fetch(newURL);

	const newResponse = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});

	newResponse.headers.set('X-New-URL', newURL);
	return newResponse;
}

async function getSUB(api, request, 追加UA, userAgentHeader) {
	if (!api || api.length === 0) {
		return [[], ""];
	}
	api = [...new Set(api)]; // 去重
	let newapi = "";
	let 订阅转换URLs = "";
	let 异常订阅 = "";

	try {
		const responses = await Promise.allSettled(
			api.map(apiUrl => {
				// 每个请求独立的超时控制
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), SUB_FETCH_TIMEOUT);
				return getUrl(request, apiUrl, 追加UA, userAgentHeader, controller.signal)
					.then(response => response.ok ? response.text() : Promise.reject(response))
					.finally(() => clearTimeout(timeout));
			})
		);

		const modifiedResponses = responses.map((response, index) => {
			if (response.status === 'rejected') {
				const reason = response.reason;
				if (reason && reason.name === 'AbortError') {
					return { status: '超时', value: null, apiUrl: api[index] };
				}
				console.error(`请求失败: ${api[index]}, 错误信息: ${reason.status} ${reason.statusText}`);
				return { status: '请求失败', value: null, apiUrl: api[index] };
			}
			return { status: response.status, value: response.value, apiUrl: api[index] };
		});

		console.log(modifiedResponses);

		for (const response of modifiedResponses) {
			if (response.status === 'fulfilled') {
				const content = response.value || 'null';
				if (content.includes('proxies:')) {
					订阅转换URLs += "|" + response.apiUrl;
				} else if (content.includes('outbounds"') && content.includes('inbounds"')) {
					订阅转换URLs += "|" + response.apiUrl;
				} else if (content.includes('://')) {
					newapi += content + '\n';
				} else if (isValidBase64(content)) {
					newapi += base64Decode(content) + '\n';
				} else {
					const 异常订阅LINK = `trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#%E5%BC%82%E5%B8%B8%E8%AE%A2%E9%98%85%20${response.apiUrl.split('://')[1].split('/')[0]}`;
					console.log('异常订阅: ' + 异常订阅LINK);
					异常订阅 += `${异常订阅LINK}\n`;
				}
			}
		}
	} catch (error) {
		console.error(error);
	}

	const 订阅内容 = ADD(newapi + 异常订阅);
	return [订阅内容, 订阅转换URLs];
}

async function getUrl(request, targetUrl, 追加UA, userAgentHeader, signal) {
	const newHeaders = new Headers(request.headers);
	newHeaders.set("User-Agent", `${atob('djJyYXlOLzYuNDU=')} cmliu/CF-Workers-SUB ${追加UA}(${userAgentHeader})`);

	const modifiedRequest = new Request(targetUrl, {
		method: request.method,
		headers: newHeaders,
		body: request.method === "GET" ? null : request.body,
		redirect: "follow",
		signal: signal, // 传入 AbortController signal，超时真正取消请求
	});

	console.log(`请求URL: ${targetUrl}`);
	return fetch(modifiedRequest);
}

function isValidBase64(str) {
	const cleanStr = str.replace(/\s/g, '');
	const base64Regex = /^[A-Za-z0-9+/=]+$/;
	return base64Regex.test(cleanStr);
}

async function 迁移地址列表(env, txt = 'ADD.txt') {
	const 旧数据 = await env.KV.get(`/${txt}`);
	const 新数据 = await env.KV.get(txt);

	if (旧数据 && !新数据) {
		await env.KV.put(txt, 旧数据);
		await env.KV.delete(`/${txt}`);
		return true;
	}
	return false;
}

async function KV(request, env, txt = 'ADD.txt', guest, mytoken, subProtocol, subConverter, subConfig, fileName, botToken, chatID) {
	const url = new URL(request.url);
	try {
		// POST请求处理 - 添加大小限制和认证
		if (request.method === "POST") {
			if (!env.KV) return new Response("未绑定KV空间", { status: 400, headers: withSecurityHeaders({ "Content-Type": "text/plain;charset=utf-8" }) });

			// POST 请求也需要验证 token（支持查询参数和路径两种方式）
			const postToken = url.searchParams.get('token');
			const currentDate = new Date();
			currentDate.setHours(0, 0, 0, 0);
			const timeTemp = Math.ceil(currentDate.getTime() / 1000);
			const expectedToken = env.TOKEN || DEFAULT_TOKEN;
			const expectedFake = await MD5MD5(`${expectedToken}${timeTemp}`);
			const expectedGuest = env.GUESTTOKEN || env.GUEST || await MD5MD5(expectedToken);
			const isPostAuthed = [expectedToken, expectedFake, expectedGuest].includes(postToken) ||
				url.pathname == ("/" + expectedToken);
			if (!isPostAuthed) {
				return new Response("未授权", { status: 403, headers: withSecurityHeaders({ "Content-Type": "text/plain;charset=utf-8" }) });
			}

			try {
				const content = await request.text();
				// 校验 body 大小
				if (content.length > KV_BODY_LIMIT) {
					return new Response(`内容超出限制 (最大 ${KV_BODY_LIMIT / 1024}KB)`, { status: 413, headers: withSecurityHeaders({ "Content-Type": "text/plain;charset=utf-8" }) });
				}
				await env.KV.put(txt, content);
				return new Response("保存成功", { headers: withSecurityHeaders({ "Content-Type": "text/plain;charset=utf-8" }) });
			} catch (error) {
				console.error('保存KV时发生错误:', error);
				return new Response("保存失败: " + error.message, { status: 500, headers: withSecurityHeaders({ "Content-Type": "text/plain;charset=utf-8" }) });
			}
		}

		// GET请求部分
		let content = '';
		const hasKV = !!env.KV;

		if (hasKV) {
			try {
				content = await env.KV.get(txt) || '';
			} catch (error) {
				console.error('读取KV时发生错误:', error);
				content = '读取数据时发生错误: ' + error.message;
			}
		}

		// 所有动态变量均经过 escapeHtml 转义，防止 XSS
		const html = `
			<!DOCTYPE html>
			<html>
				<head>
					<title>${escapeHtml(fileName)} 订阅编辑</title>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1">
					<style>
						body {
							margin: 0;
							padding: 15px;
							box-sizing: border-box;
							font-size: 13px;
						}
						.editor-container {
							width: 100%;
							max-width: 100%;
							margin: 0 auto;
						}
						.editor {
							width: 100%;
							height: 300px;
							margin: 15px 0;
							padding: 10px;
							box-sizing: border-box;
							border: 1px solid #ccc;
							border-radius: 4px;
							font-size: 13px;
							line-height: 1.5;
							overflow-y: auto;
							resize: none;
						}
						.save-container {
							margin-top: 8px;
							display: flex;
							align-items: center;
							gap: 10px;
						}
						.save-btn, .back-btn {
							padding: 6px 15px;
							color: white;
							border: none;
							border-radius: 4px;
							cursor: pointer;
						}
						.save-btn {
							background: #4CAF50;
						}
						.save-btn:hover {
							background: #45a049;
						}
						.back-btn {
							background: #666;
						}
						.back-btn:hover {
							background: #555;
						}
						.save-status {
							color: #666;
						}
					</style>
					<script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
				</head>
				<body>
					################################################################<br>
					Subscribe / sub 订阅地址, 点击链接自动 <strong>复制订阅链接</strong> 并 <strong>生成订阅二维码</strong> <br>
					---------------------------------------------------------------<br>
					自适应订阅地址:<br>
					<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?sub','qrcode_0')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}</a><br>
					<div id="qrcode_0" style="margin: 10px 10px 10px 10px;"></div>
					Base64订阅地址:<br>
					<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?b64','qrcode_1')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?b64</a><br>
					<div id="qrcode_1" style="margin: 10px 10px 10px 10px;"></div>
					clash订阅地址:<br>
					<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?clash','qrcode_2')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?clash</a><br>
					<div id="qrcode_2" style="margin: 10px 10px 10px 10px;"></div>
					singbox订阅地址:<br>
					<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?sb','qrcode_3')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?sb</a><br>
					<div id="qrcode_3" style="margin: 10px 10px 10px 10px;"></div>
					surge订阅地址:<br>
					<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?surge','qrcode_4')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?surge</a><br>
					<div id="qrcode_4" style="margin: 10px 10px 10px 10px;"></div>
					loon订阅地址:<br>
					<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?loon','qrcode_5')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/${escapeHtml(mytoken)}?loon</a><br>
					<div id="qrcode_5" style="margin: 10px 10px 10px 10px;"></div>
					&nbsp;&nbsp;<strong><a href="javascript:void(0);" id="noticeToggle" onclick="toggleNotice()">查看访客订阅∨</a></strong><br>
					<div id="noticeContent" class="notice-content" style="display: none;">
						---------------------------------------------------------------<br>
						访客订阅只能使用订阅功能，无法查看配置页！<br>
						GUEST（访客订阅TOKEN）: <strong>${escapeHtml(guest)}</strong><br>
						---------------------------------------------------------------<br>
						自适应订阅地址:<br>
						<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}','guest_0')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}</a><br>
						<div id="guest_0" style="margin: 10px 10px 10px 10px;"></div>
						Base64订阅地址:<br>
						<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&b64','guest_1')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&b64</a><br>
						<div id="guest_1" style="margin: 10px 10px 10px 10px;"></div>
						clash订阅地址:<br>
						<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&clash','guest_2')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&clash</a><br>
						<div id="guest_2" style="margin: 10px 10px 10px 10px;"></div>
						singbox订阅地址:<br>
						<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&sb','guest_3')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&sb</a><br>
						<div id="guest_3" style="margin: 10px 10px 10px 10px;"></div>
						surge订阅地址:<br>
						<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&surge','guest_4')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&surge</a><br>
						<div id="guest_4" style="margin: 10px 10px 10px 10px;"></div>
						loon订阅地址:<br>
						<a href="javascript:void(0)" onclick="copyToClipboard('https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&loon','guest_5')" style="color:blue;text-decoration:underline;cursor:pointer;">https://${escapeHtml(url.hostname)}/sub?token=${escapeHtml(guest)}&loon</a><br>
						<div id="guest_5" style="margin: 10px 10px 10px 10px;"></div>
					</div>
					---------------------------------------------------------------<br>
					################################################################<br>
					订阅转换配置<br>
					---------------------------------------------------------------<br>
					SUBAPI（订阅转换后端）: <strong>${escapeHtml(subProtocol)}://${escapeHtml(subConverter)}</strong><br>
					SUBCONFIG（订阅转换配置文件）: <strong>${escapeHtml(subConfig)}</strong><br>
					---------------------------------------------------------------<br>
					################################################################<br>
					${escapeHtml(fileName)} 汇聚订阅编辑: 
					<div class="editor-container">
						${hasKV ? `
						<textarea class="editor" 
							placeholder="LINK示例（一行一个节点链接即可）：
vless://246aa795-0637-4f4c-8f64-2c8fb24c1bad@127.0.0.1:1234?encryption=none&amp;security=tls&amp;sni=TG.CMLiussss.loseyourip.com&amp;allowInsecure=1&amp;type=ws&amp;host=TG.CMLiussss.loseyourip.com&amp;path=%2F%3Fed%3D2560#CFnat
trojan://aa6ddd2f-d1cf-4a52-ba1b-2640c41a7856@218.190.230.207:41288?security=tls&amp;sni=hk12.bilibili.com&amp;allowInsecure=1&amp;type=tcp&amp;headerType=none#HK
ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNToyRXRQcW42SFlqVU5jSG9oTGZVcEZRd25makNDUTVtaDFtSmRFTUNCdWN1V1o5UDF1ZGtSS0huVnh1bzU1azFLWHoyRm82anJndDE4VzY2b3B0eTFlNGJtMWp6ZkNmQmI=@84.19.31.63:50841#DE


订阅链接示例（一行一条订阅链接即可）：
https://sub.xf.free.hr/auto"
							id="content">${escapeHtml(content)}</textarea>
						<div class="save-container">
							<button class="save-btn" onclick="saveContent(this)">保存</button>
							<span class="save-status" id="saveStatus"></span>
						</div>
						` : '<p>请绑定 <strong>变量名称</strong> 为 <strong>KV</strong> 的KV命名空间</p>'}
					</div>
					<br>
					################################################################<br>
					telegram 交流群 技术大佬~在线发牌!<br>
					<a href='https://t.me/CMLiussss'>https://t.me/CMLiussss</a><br>
					----------------------------------------------------------------<br>
					github 项目地址 Star!Star!Star!!!<br>
					<a href='https://github.com/cmliu/CF-Workers-SUB'>https://github.com/cmliu/CF-Workers-SUB</a><br>
					----------------------------------------------------------------<br>
					################################################################
					<br><br>UA: <strong>${escapeHtml(request.headers.get('User-Agent'))}</strong>
					<script>
					function copyToClipboard(text, qrcode) {
						navigator.clipboard.writeText(text).then(() => {
							alert('已复制到剪贴板');
						}).catch(err => {
							console.error('复制失败:', err);
						});
						const qrcodeDiv = document.getElementById(qrcode);
						qrcodeDiv.innerHTML = '';
						new QRCode(qrcodeDiv, {
							text: text,
							width: 220,
							height: 220,
							colorDark: "#000000",
							colorLight: "#ffffff",
							correctLevel: QRCode.CorrectLevel.Q,
							scale: 1
						});
					}
						
					if (document.querySelector('.editor')) {
						let timer;
						const textarea = document.getElementById('content');
						const originalContent = textarea.value;
		
						function goBack() {
							const currentUrl = window.location.href;
							const parentUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/'));
							window.location.href = parentUrl;
						}
		
						function replaceFullwidthColon() {
							const text = textarea.value;
							textarea.value = text.replace(/：/g, ':');
						}
						
						function saveContent(button) {
							try {
								const updateButtonText = (step) => {
									button.textContent = \`保存中: \${step}\`;
								};
								const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
								
								if (!isIOS) {
									replaceFullwidthColon();
								}
								updateButtonText('开始保存');
								button.disabled = true;

								const textarea = document.getElementById('content');
								if (!textarea) {
									throw new Error('找不到文本编辑区域');
								}

								updateButtonText('获取内容');
								let newContent;
								let originalContent;
								try {
									newContent = textarea.value || '';
									originalContent = textarea.defaultValue || '';
								} catch (e) {
									console.error('获取内容错误:', e);
									throw new Error('无法获取编辑内容');
								}

								updateButtonText('准备状态更新函数');
								const updateStatus = (message, isError = false) => {
									const statusElem = document.getElementById('saveStatus');
									if (statusElem) {
										statusElem.textContent = message;
										statusElem.style.color = isError ? 'red' : '#666';
									}
								};

								updateButtonText('准备按钮重置函数');
								const resetButton = () => {
									button.textContent = '保存';
									button.disabled = false;
								};

								if (newContent !== originalContent) {
									updateButtonText('发送保存请求');
									fetch(window.location.href, {
										method: 'POST',
										body: newContent,
										headers: {
											'Content-Type': 'text/plain;charset=UTF-8'
										},
										cache: 'no-cache'
									})
									.then(response => {
										updateButtonText('检查响应状态');
										if (!response.ok) {
											throw new Error(\`HTTP error! status: \${response.status}\`);
										}
										updateButtonText('更新保存状态');
										const now = new Date().toLocaleString();
										document.title = \`编辑已保存 \${now}\`;
										updateStatus(\`已保存 \${now}\`);
									})
									.catch(error => {
										updateButtonText('处理错误');
										console.error('Save error:', error);
										updateStatus(\`保存失败: \${error.message}\`, true);
									})
									.finally(() => {
										resetButton();
									});
								} else {
									updateButtonText('检查内容变化');
									updateStatus('内容未变化');
									resetButton();
								}
							} catch (error) {
								console.error('保存过程出错:', error);
								button.textContent = '保存';
								button.disabled = false;
								const statusElem = document.getElementById('saveStatus');
								if (statusElem) {
									statusElem.textContent = \`错误: \${error.message}\`;
									statusElem.style.color = 'red';
								}
							}
						}
		
						textarea.addEventListener('input', () => {
							clearTimeout(timer);
							timer = setTimeout(saveContent, 5000);
						});
					}

					function toggleNotice() {
						const noticeContent = document.getElementById('noticeContent');
						const noticeToggle = document.getElementById('noticeToggle');
						if (noticeContent.style.display === 'none' || noticeContent.style.display === '') {
							noticeContent.style.display = 'block';
							noticeToggle.textContent = '隐藏访客订阅∧';
						} else {
							noticeContent.style.display = 'none';
							noticeToggle.textContent = '查看访客订阅∨';
						}
					}
			
					document.addEventListener('DOMContentLoaded', () => {
						document.getElementById('noticeContent').style.display = 'none';
					});
					</script>
				</body>
			</html>
		`;

		return new Response(html, {
			headers: withSecurityHeaders({ "Content-Type": "text/html;charset=utf-8" })
		});
	} catch (error) {
		console.error('处理请求时发生错误:', error);
		return new Response("服务器错误: " + error.message, {
			status: 500,
			headers: withSecurityHeaders({ "Content-Type": "text/plain;charset=utf-8" })
		});
	}
}
