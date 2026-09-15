// ==UserScript==
// @name         69書吧自訂小說橋接器
// @namespace    strategy-forge.local
// @version      1.0.0
// @description  使用真正的 69書吧章節頁作為閱讀外殼，載入自己的小說內容，並保留可供 Raindrop 收藏的 69書吧網址。
// @author       You
// @match        https://69shuba.com/*
// @match        https://www.69shuba.com/*
// @match        https://69shuba.tw/*
// @match        https://www.69shuba.tw/*
// @connect      freeze2212.github.io
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// @downloadURL  https://freeze2212.github.io/novel/69shuba_custom_novel.user.js
// @updateURL    https://freeze2212.github.io/novel/69shuba_custom_novel.user.js
// ==/UserScript==

(function () {
    'use strict';

    const BOOK = Object.freeze({
        id: 'hogwarts-bad-intentions',
        title: '霍格沃茨：小巫師能有什麼壞心思',
        first: 206,
        last: 484,
        dataRoot: 'https://freeze2212.github.io/novel'
    });

    const PARAM_BOOK = 'sf_novel';
    const PARAM_CHAPTER = 'sf_chapter';
    const PARAM_VIEW = 'sf_view';
    const SHELL_KEY = `sf_shell_${BOOK.id}`;
    const ROOT_SELECTORS = ['.txtnav', '#nr1', '#nr', '#txtContent', '#content', '.novel-content'];
    const params = new URLSearchParams(location.search);
    const bridgeMode = params.get(PARAM_BOOK) === BOOK.id;

    function baseShellUrl() {
        const saved = GM_getValue(SHELL_KEY, '');
        const url = new URL(saved || location.href);
        url.hash = '';
        url.searchParams.delete(PARAM_BOOK);
        url.searchParams.delete(PARAM_CHAPTER);
        url.searchParams.delete(PARAM_VIEW);
        return url;
    }

    function chapterUrl(chapter) {
        const url = baseShellUrl();
        url.searchParams.set(PARAM_BOOK, BOOK.id);
        url.searchParams.set(PARAM_CHAPTER, String(chapter));
        return url.href;
    }

    function catalogUrl() {
        const url = baseShellUrl();
        url.searchParams.set(PARAM_BOOK, BOOK.id);
        url.searchParams.set(PARAM_VIEW, 'catalog');
        return url.href;
    }

    function originalUrl() {
        return baseShellUrl().href;
    }

    function rememberCurrentPageAsShell() {
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.delete(PARAM_BOOK);
        url.searchParams.delete(PARAM_CHAPTER);
        url.searchParams.delete(PARAM_VIEW);
        GM_setValue(SHELL_KEY, url.href);
        location.href = chapterUrl(BOOK.first);
    }

    function rememberBridgeLinkShell() {
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.delete(PARAM_BOOK);
        url.searchParams.delete(PARAM_CHAPTER);
        url.searchParams.delete(PARAM_VIEW);
        GM_setValue(SHELL_KEY, url.href);
    }

    function requestText(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 20000,
                headers: { Accept: 'text/html' },
                onload(response) {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                ontimeout() { reject(new Error('載入逾時')); },
                onerror() { reject(new Error('網路錯誤')); }
            });
        });
    }

    function findReadingRoot() {
        for (const selector of ROOT_SELECTORS) {
            const element = document.querySelector(selector);
            if (element) return element;
        }
        return null;
    }

    function waitForReadingRoot(timeoutMs = 15000) {
        const immediate = findReadingRoot();
        if (immediate) return Promise.resolve(immediate);

        return new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
                const root = findReadingRoot();
                if (!root) return;
                observer.disconnect();
                clearTimeout(timer);
                resolve(root);
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            const timer = setTimeout(() => {
                observer.disconnect();
                reject(new Error('找不到 69書吧正文區；請改在一個正常章節頁啟動'));
            }, timeoutMs);
        });
    }

    function installSmallStyles() {
        if (document.getElementById('sf-bridge-style')) return;
        const style = document.createElement('style');
        style.id = 'sf-bridge-style';
        style.textContent = `
            #sf-open-custom-novel {
                position: fixed; right: 18px; bottom: 22px; z-index: 2147483647;
                padding: 10px 15px; border: 0; border-radius: 8px;
                background: #7b5a3a; color: #fff; cursor: pointer;
                box-shadow: 0 2px 10px rgba(0,0,0,.25); font-size: 15px;
            }
            .sf-bridge-note { text-align: center; opacity: .68; font-size: 13px; margin: 8px 0 18px; }
            .sf-bridge-error { padding: 20px; color: #b42318; white-space: pre-wrap; }
            .sf-bridge-nav { display: flex; justify-content: center; gap: 1em; margin: 20px auto; }
            .sf-bridge-nav a { padding: .45em .8em; }
            .sf-bridge-catalog { list-style: none; padding: 0; margin: 1em auto; max-width: 980px; }
            .sf-bridge-catalog li { border-bottom: 1px dashed rgba(128,128,128,.28); }
            .sf-bridge-catalog a { display: block; padding: .65em .35em; text-decoration: none; }
        `;
        document.head.appendChild(style);
    }

    function addOpenButton() {
        if (document.getElementById('sf-open-custom-novel')) return;
        installSmallStyles();
        const button = document.createElement('button');
        button.id = 'sf-open-custom-novel';
        button.type = 'button';
        button.textContent = '📖 開啟自訂小說';
        button.title = '把目前這個 69書吧章節頁設為閱讀外殼';
        button.addEventListener('click', rememberCurrentPageAsShell);
        document.body.appendChild(button);
    }

    function makeNativeHeading(root, title) {
        const oldHeading = root.querySelector('h1, h2');
        const heading = oldHeading ? oldHeading.cloneNode(false) : document.createElement('h1');
        heading.textContent = title;
        return heading;
    }

    function makeNote() {
        const note = document.createElement('div');
        note.className = 'sf-bridge-note';
        note.textContent = '自訂小說內容 · 69書吧閱讀外殼';
        return note;
    }

    function makeFallbackNav(chapter) {
        const nav = document.createElement('div');
        nav.className = 'readpage sf-bridge-nav';

        const previous = document.createElement('a');
        previous.textContent = '上一章';
        if (chapter > BOOK.first) previous.href = chapterUrl(chapter - 1);
        else previous.style.visibility = 'hidden';

        const catalog = document.createElement('a');
        catalog.textContent = '目錄';
        catalog.href = catalogUrl();

        const next = document.createElement('a');
        next.textContent = '下一章';
        if (chapter < BOOK.last) next.href = chapterUrl(chapter + 1);
        else next.style.visibility = 'hidden';

        nav.append(previous, catalog, next);
        return nav;
    }

    function rewriteNativeNavigation(chapter) {
        let rewritten = 0;
        for (const anchor of document.querySelectorAll('a')) {
            const label = anchor.textContent.replace(/\s+/g, ' ').trim();
            if (/上一章/.test(label)) {
                if (chapter > BOOK.first) anchor.href = chapterUrl(chapter - 1);
                else anchor.removeAttribute('href');
                rewritten++;
            } else if (/下一章/.test(label)) {
                if (chapter < BOOK.last) anchor.href = chapterUrl(chapter + 1);
                else anchor.removeAttribute('href');
                rewritten++;
            } else if (/^(目錄|目录|返回目錄|返回目录|章節目錄|章节目录)$/.test(label)) {
                anchor.href = catalogUrl();
                rewritten++;
            }
        }
        return rewritten;
    }

    function preservedNativeNavs(root) {
        return [...root.querySelectorAll('.readinline, .readpage, .readpage2')]
            .map(element => element.cloneNode(true));
    }

    function showLoading(root, message) {
        const heading = makeNativeHeading(root, message);
        root.replaceChildren(heading);
    }

    function showError(root, error) {
        const box = document.createElement('div');
        box.className = 'sf-bridge-error';
        box.textContent = `載入自訂小說失敗：${error.message}\n\n可從油猴選單選「回到原本的 69書吧頁面」。`;
        root.replaceChildren(box);
    }

    async function renderChapter(root, chapter) {
        if (!Number.isInteger(chapter) || chapter < BOOK.first || chapter > BOOK.last) {
            throw new Error(`章節必須介於 ${BOOK.first}～${BOOK.last}`);
        }

        const nativeNavs = preservedNativeNavs(root);
        showLoading(root, `正在載入第 ${chapter} 章……`);

        const source = await requestText(`${BOOK.dataRoot}/${chapter}.html`);
        const sourceDoc = new DOMParser().parseFromString(source, 'text/html');
        const sourceHeading = sourceDoc.querySelector('h1');
        const lines = [...sourceDoc.querySelectorAll('.content p')]
            .map(element => element.textContent.trim())
            .filter(Boolean);

        if (!sourceHeading || lines.length === 0) {
            throw new Error('來源章節格式不正確');
        }

        const chapterTitle = sourceHeading.textContent.trim();
        const heading = makeNativeHeading(root, chapterTitle);
        const fragment = document.createDocumentFragment();
        fragment.append(heading, makeNote());

        for (const line of lines) {
            fragment.append(document.createTextNode(`　　${line.replace(/^　{2}/, '')}`));
            fragment.append(document.createElement('br'), document.createElement('br'));
        }

        for (const nav of nativeNavs) fragment.append(nav);
        if (nativeNavs.length === 0) fragment.append(makeFallbackNav(chapter));
        root.replaceChildren(fragment);

        document.title = `${chapterTitle}｜${BOOK.title}｜69書吧`;
        rewriteNativeNavigation(chapter);
        window.dispatchEvent(new CustomEvent('sf:chapter-loaded', {
            detail: { book: BOOK.id, chapter, title: chapterTitle }
        }));
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    async function renderCatalog(root) {
        showLoading(root, `正在載入《${BOOK.title}》目錄……`);
        const source = await requestText(`${BOOK.dataRoot}/index.html`);
        const sourceDoc = new DOMParser().parseFromString(source, 'text/html');
        const sourceLinks = [...sourceDoc.querySelectorAll('.toc a')];
        if (sourceLinks.length === 0) throw new Error('來源目錄格式不正確');

        const heading = makeNativeHeading(root, BOOK.title);
        const list = document.createElement('ul');
        list.className = 'catalog sf-bridge-catalog';

        for (const sourceLink of sourceLinks) {
            const match = sourceLink.getAttribute('href')?.match(/(\d+)\.html/);
            if (!match) continue;
            const chapter = Number(match[1]);
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = chapterUrl(chapter);
            link.textContent = sourceLink.textContent.trim();
            item.append(link);
            list.append(item);
        }

        root.replaceChildren(heading, makeNote(), list);
        document.title = `${BOOK.title}｜目錄｜69書吧`;
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    async function startBridge() {
        installSmallStyles();
        const root = await waitForReadingRoot();
        try {
            if (params.get(PARAM_VIEW) === 'catalog') {
                await renderCatalog(root);
                return;
            }
            const chapter = Number(params.get(PARAM_CHAPTER) || BOOK.first);
            await renderChapter(root, chapter);
        } catch (error) {
            showError(root, error);
            console.error('[69書吧自訂小說橋接器]', error);
        }
    }

    GM_registerMenuCommand('以目前章節頁開啟自訂小說', rememberCurrentPageAsShell);
    if (bridgeMode) {
        // 從 Raindrop 或另一台裝置打開連結時，以連結本身的路徑作為外殼。
        rememberBridgeLinkShell();
        GM_registerMenuCommand('回到原本的 69書吧頁面', () => { location.href = originalUrl(); });
        startBridge().catch(error => console.error('[69書吧自訂小說橋接器]', error));
    } else if (findReadingRoot()) {
        addOpenButton();
    }
})();
