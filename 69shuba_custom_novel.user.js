// ==UserScript==
// @name         69書吧自訂小說橋接器
// @namespace    strategy-forge.local
// @version      2.1.0
// @description  使用真正的 69書吧章節頁作為閱讀外殼，載入自己的「多本」小說內容，並保留可供 Raindrop 收藏的 69書吧網址。
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

    /* ==========================================================
     * 小說清單（路線 B）
     * 以後每加一本小說，就往下複製一段 { ... } 物件即可：
     *   id       ：網址參數用的識別碼，只用英數與「-」，且必須唯一
     *   title    ：顯示的書名
     *   first    ：第一章的檔名編號（例如 1.html -> 1）
     *   last     ：最後一章的檔名編號
     *   dataRoot ：舊式多檔小說的網址（index.html + 各章「數字.html」）
     *   dataFile ：新式單檔小說的完整 book.html 網址；與 dataRoot 二選一
     *
     * ⚠ 若新書的 dataRoot 在「不同網域」，記得在上方 @connect 也補一行該網域，
     *    否則 GM_xmlhttpRequest 會被擋下、抓不到內容。
     * ========================================================== */
    const BOOKS = [
        {
            id: 'hogwarts-bad-intentions',
            title: '霍格沃茨：小巫師能有什麼壞心思',
            first: 206,
            last: 484,
            dataRoot: 'https://freeze2212.github.io/novel'
        },
        {
            id: 'my-magic-no-limit',
            title: '我的魔法沒有上限',
            first: 1,
            last: 528,
            dataFile: 'https://freeze2212.github.io/novel/mofa/book.html'
        }
    ];

    const PARAM_BOOK = 'sf_novel';
    const PARAM_CHAPTER = 'sf_chapter';
    const PARAM_VIEW = 'sf_view';
    const SHELL_KEY = 'sf_shell';                     // 外殼所有書共用
    const lastChapterKey = id => `sf_last_chapter_${id}`;
    const ROOT_SELECTORS = ['.txtnav', '#nr1', '#nr', '#txtContent', '#content', '.novel-content'];
    const params = new URLSearchParams(location.search);

    function findBook(id) {
        return BOOKS.find(book => book.id === id) || null;
    }

    // 目前這一頁對應到哪一本書（非橋接模式時為 null）。
    const BOOK = findBook(params.get(PARAM_BOOK));
    const bridgeMode = BOOK !== null;

    function baseShellUrl() {
        const saved = GM_getValue(SHELL_KEY, '');
        const url = new URL(saved || location.href);
        url.hash = '';
        url.searchParams.delete(PARAM_BOOK);
        url.searchParams.delete(PARAM_CHAPTER);
        url.searchParams.delete(PARAM_VIEW);
        return url;
    }

    function chapterUrl(book, chapter) {
        const url = baseShellUrl();
        url.searchParams.set(PARAM_BOOK, book.id);
        url.searchParams.set(PARAM_CHAPTER, String(chapter));
        url.searchParams.delete(PARAM_VIEW);
        return url.href;
    }

    function catalogUrl(book) {
        const url = baseShellUrl();
        url.searchParams.set(PARAM_BOOK, book.id);
        url.searchParams.set(PARAM_VIEW, 'catalog');
        url.searchParams.delete(PARAM_CHAPTER);
        return url.href;
    }

    function originalUrl() {
        return baseShellUrl().href;
    }

    function validChapter(book, chapter) {
        return Number.isInteger(chapter) && chapter >= book.first && chapter <= book.last;
    }

    function savedChapterFor(book) {
        const saved = Number(GM_getValue(lastChapterKey(book.id), book.first));
        return validChapter(book, saved) ? saved : book.first;
    }

    function hasShell() {
        return Boolean(GM_getValue(SHELL_KEY, '')) || Boolean(findReadingRoot());
    }

    function openBook(book) {
        location.href = chapterUrl(book, savedChapterFor(book));
    }

    function rememberCurrentPageAsShell() {
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.delete(PARAM_BOOK);
        url.searchParams.delete(PARAM_CHAPTER);
        url.searchParams.delete(PARAM_VIEW);
        GM_setValue(SHELL_KEY, url.href);
        // 設定完外殼後，直接讓使用者挑一本書開始讀。
        openChooserOrSingle();
    }

    function isBookcasePage() {
        return location.pathname.toLowerCase() === '/modules/article/bookcase.php';
    }

    function openChooserOrSingle() {
        if (!hasShell()) {
            alert('尚未設定 69書吧閱讀外殼。\n\n請先打開任意一本小說的正常章節頁，再從 Tampermonkey 選單執行「以目前章節頁設定閱讀外殼」。');
            return;
        }
        if (BOOKS.length === 1) {
            openBook(BOOKS[0]);
            return;
        }
        showBookChooser();
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
            #sf-book-chooser {
                position: fixed; inset: 0; z-index: 2147483647;
                background: rgba(0,0,0,.45); display: flex;
                align-items: center; justify-content: center;
            }
            #sf-book-chooser .sf-chooser-panel {
                background: #fff; color: #222; min-width: 260px; max-width: 90vw;
                max-height: 80vh; overflow: auto; border-radius: 12px; padding: 14px;
                box-shadow: 0 10px 40px rgba(0,0,0,.35);
            }
            #sf-book-chooser .sf-chooser-title {
                font-size: 16px; font-weight: 700; margin: 4px 6px 12px;
            }
            #sf-book-chooser .sf-chooser-item {
                display: block; width: 100%; text-align: left; box-sizing: border-box;
                padding: 12px 14px; margin: 6px 0; border: 0; border-radius: 8px;
                background: #f2ede6; color: #3b2f21; font-size: 15px; cursor: pointer;
            }
            #sf-book-chooser .sf-chooser-item:hover { background: #e6dccc; }
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

    function showBookChooser() {
        installSmallStyles();
        const existing = document.getElementById('sf-book-chooser');
        if (existing) { existing.remove(); return; }

        const overlay = document.createElement('div');
        overlay.id = 'sf-book-chooser';

        const panel = document.createElement('div');
        panel.className = 'sf-chooser-panel';

        const title = document.createElement('div');
        title.className = 'sf-chooser-title';
        title.textContent = '選擇小說';
        panel.appendChild(title);

        for (const book of BOOKS) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'sf-chooser-item';
            item.textContent = book.title;
            item.addEventListener('click', () => openBook(book));
            panel.appendChild(item);
        }

        overlay.appendChild(panel);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
    }

    function addOpenButton() {
        if (document.getElementById('sf-open-custom-novel')) return;
        installSmallStyles();
        const button = document.createElement('button');
        button.id = 'sf-open-custom-novel';
        button.type = 'button';
        button.textContent = '📖 開啟自訂小說';
        button.title = '開啟自訂小說';
        button.addEventListener('click', openChooserOrSingle);
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

    function makeFallbackNav(book, chapter) {
        const nav = document.createElement('div');
        nav.className = 'readpage sf-bridge-nav';

        const previous = document.createElement('a');
        previous.textContent = '上一章';
        if (chapter > book.first) previous.href = chapterUrl(book, chapter - 1);
        else previous.style.visibility = 'hidden';

        const catalog = document.createElement('a');
        catalog.textContent = '目錄';
        catalog.href = catalogUrl(book);

        const next = document.createElement('a');
        next.textContent = '下一章';
        if (chapter < book.last) next.href = chapterUrl(book, chapter + 1);
        else next.style.visibility = 'hidden';

        nav.append(previous, catalog, next);
        return nav;
    }

    function rewriteNativeNavigation(book, chapter) {
        let rewritten = 0;
        for (const anchor of document.querySelectorAll('a')) {
            const label = anchor.textContent.replace(/\s+/g, ' ').trim();
            if (/上一章/.test(label)) {
                if (chapter > book.first) anchor.href = chapterUrl(book, chapter - 1);
                else anchor.removeAttribute('href');
                rewritten++;
            } else if (/下一章/.test(label)) {
                if (chapter < book.last) anchor.href = chapterUrl(book, chapter + 1);
                else anchor.removeAttribute('href');
                rewritten++;
            } else if (/^(目錄|目录|返回目錄|返回目录|章節目錄|章节目录)$/.test(label)) {
                anchor.href = catalogUrl(book);
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

    async function renderChapter(root, book, chapter) {
        if (!validChapter(book, chapter)) {
            throw new Error(`章節必須介於 ${book.first}～${book.last}`);
        }

        const nativeNavs = preservedNativeNavs(root);
        showLoading(root, `正在載入第 ${chapter} 章……`);

        const sourceUrl = book.dataFile || `${book.dataRoot}/${chapter}.html`;
        const source = await requestText(sourceUrl);
        const sourceDoc = new DOMParser().parseFromString(source, 'text/html');
        const sourceRoot = book.dataFile
            ? sourceDoc.querySelector(`.sf-book-chapter[data-sf-chapter="${chapter}"]`)
            : sourceDoc;
        const sourceHeading = sourceRoot?.querySelector('h1');
        const lines = [...(sourceRoot?.querySelectorAll('.content p') || [])]
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
        if (nativeNavs.length === 0) fragment.append(makeFallbackNav(book, chapter));
        root.replaceChildren(fragment);

        document.title = `${chapterTitle}｜${book.title}｜69書吧`;
        document.documentElement.dataset.sfBridgeReady = '1';
        document.documentElement.dataset.sfNovelTitle = book.title;
        document.documentElement.dataset.sfChapter = String(chapter);
        GM_setValue(lastChapterKey(book.id), chapter);
        rewriteNativeNavigation(book, chapter);
        window.dispatchEvent(new CustomEvent('sf:chapter-loaded', {
            detail: { book: book.id, bookTitle: book.title, chapter, title: chapterTitle }
        }));
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    async function renderCatalog(root, book) {
        showLoading(root, `正在載入《${book.title}》目錄……`);
        const sourceUrl = book.dataFile || `${book.dataRoot}/index.html`;
        const source = await requestText(sourceUrl);
        const sourceDoc = new DOMParser().parseFromString(source, 'text/html');
        const sourceLinks = [...sourceDoc.querySelectorAll('.toc a')];
        if (sourceLinks.length === 0) throw new Error('來源目錄格式不正確');

        const heading = makeNativeHeading(root, book.title);
        const list = document.createElement('ul');
        list.className = 'catalog sf-bridge-catalog';

        for (const sourceLink of sourceLinks) {
            const href = sourceLink.getAttribute('href') || '';
            const match = href.match(/(\d+)(?:\.html)?(?:$|[#?])/);
            const chapter = Number(sourceLink.dataset.chapter || match?.[1]);
            if (!validChapter(book, chapter)) continue;
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = chapterUrl(book, chapter);
            link.textContent = sourceLink.textContent.trim();
            item.append(link);
            list.append(item);
        }

        root.replaceChildren(heading, makeNote(), list);
        document.title = `${book.title}｜目錄｜69書吧`;
        document.documentElement.dataset.sfBridgeReady = '1';
        document.documentElement.dataset.sfNovelTitle = book.title;
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    async function startBridge() {
        installSmallStyles();
        const root = await waitForReadingRoot();
        try {
            if (params.get(PARAM_VIEW) === 'catalog') {
                await renderCatalog(root, BOOK);
                return;
            }
            const chapter = Number(params.get(PARAM_CHAPTER) || BOOK.first);
            await renderChapter(root, BOOK, chapter);
        } catch (error) {
            showError(root, error);
            console.error('[69書吧自訂小說橋接器]', error);
        }
    }

    if (findReadingRoot()) {
        GM_registerMenuCommand('以目前章節頁設定閱讀外殼', rememberCurrentPageAsShell);
    }
    if (bridgeMode) {
        // 從 Raindrop 或另一台裝置打開連結時，以連結本身的路徑作為外殼。
        rememberBridgeLinkShell();
        GM_registerMenuCommand('回到原本的 69書吧頁面', () => { location.href = originalUrl(); });
        startBridge().catch(error => console.error('[69書吧自訂小說橋接器]', error));
    } else if (isBookcasePage()) {
        addOpenButton();
    }
})();
