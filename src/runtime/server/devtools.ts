import { defineEventHandler } from 'nuxt/server'

export default defineEventHandler((event) => {
  event.res.headers.set('content-type', 'text/html; charset=utf-8')
  return renderDevtoolsView()
})

function renderDevtoolsView(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nuxt State</title>
  <style>
    :root { color-scheme: light dark; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #d9e1ea; background: #101418; }
    header { position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; align-items: center; padding: 14px 18px; border-bottom: 1px solid #2a343e; background: #101418ee; }
    h1 { margin: 0 auto 0 0; font-size: 18px; }
    input, button { border: 1px solid #34414d; border-radius: 7px; background: #182027; color: inherit; padding: 7px 10px; }
    input { width: min(280px, 42vw); }
    button { cursor: pointer; }
    main { display: grid; gap: 12px; padding: 16px; }
    #active { display: grid; gap: 12px; }
    #known:empty, nav[hidden] { display: none; }
    nav { display: flex; gap: 8px; align-items: center; }
    article { border: 1px solid #2a343e; border-radius: 10px; background: #151b21; overflow: hidden; }
    article > div { padding: 12px 14px; }
    h2 { margin: 0; font-size: 15px; }
    .meta { color: #94a3b1; font-size: 12px; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 14px; border-top: 1px solid #27313a; text-align: left; vertical-align: top; }
    th { color: #91a0ad; font-size: 11px; text-transform: uppercase; }
    td:nth-child(1) { width: 22%; font-weight: 600; }
    td:nth-child(2) { width: 16%; color: #65d8a5; }
    pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.45 ui-monospace, monospace; }
    .empty, .error { padding: 36px; text-align: center; color: #91a0ad; }
    .badge { display: inline-block; margin-left: 7px; padding: 1px 6px; border-radius: 999px; background: #263a32; color: #7ee2ad; font-size: 11px; }
    @media (prefers-color-scheme: light) {
      body { color: #202832; background: #f7f9fb; }
      header { border-color: #d9e0e6; background: #f7f9fbee; }
      input, button, article { border-color: #d7dfe6; background: white; }
      th, td { border-color: #e3e8ed; }
      .badge { background: #dff7ea; color: #176b43; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Nuxt State <span class="badge">Read only</span></h1>
    <input id="filter" type="search" placeholder="Filter active states">
    <button id="refresh" type="button">Refresh</button>
  </header>
  <main>
    <div id="active"><p class="empty">Connecting to the Nuxt app…</p></div>
    <nav id="pagination" aria-label="Active state pages" hidden>
      <button id="previous" type="button">Previous</button>
      <span id="page"></span>
      <button id="next" type="button">Next</button>
    </nav>
    <div id="known"></div>
  </main>
  <script>
    const activeRoot = document.querySelector('#active')
    const knownRoot = document.querySelector('#known')
    const filter = document.querySelector('#filter')
    const pagination = document.querySelector('#pagination')
    const previous = document.querySelector('#previous')
    const next = document.querySelector('#next')
    const pageLabel = document.querySelector('#page')
    let page = 0
    let pages = 1
    let visible = true
    let refreshing = false
    let previousKnown
    let previousQuery

    const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
    const search = () => filter.value.trim().toLowerCase()
    const renderKnown = (knownStates, query) => {
      if (knownStates === previousKnown && query === previousQuery) return
      const known = knownStates.filter(state => (state.name + ' ' + state.source + ' ' + state.origin).toLowerCase().includes(query))
      knownRoot.innerHTML = known.length
        ? '<article><div><h2>Known states</h2><div class="meta">Discovered statically; factories remain lazy.</div></div><table><thead><tr><th>Name</th><th>Origin</th><th>Source</th></tr></thead><tbody>' + known.map(state => '<tr><td>' + escapeHTML(state.name) + '</td><td>' + escapeHTML(state.origin) + '</td><td><pre>' + escapeHTML(state.source) + '</pre></td></tr>').join('') + '</tbody></table></article>'
        : ''
      previousKnown = knownStates
      previousQuery = query
    }
    const render = (active, knownStates, query) => {
      const activeHTML = active.length
        ? active.map(state => '<article><div><h2>' + escapeHTML(state.name) + '<span class="badge">' + escapeHTML(state.hydration) + '</span></h2><div class="meta">Internal hydration key: ' + escapeHTML(state.key) + '</div></div><table><thead><tr><th>Member</th><th>Kind</th><th>Value preview</th></tr></thead><tbody>' + state.members.map(member => '<tr><td>' + escapeHTML(member.name) + '</td><td>' + escapeHTML(member.kind) + '</td><td><pre>' + escapeHTML(JSON.stringify(member.value, null, 2)) + '</pre></td></tr>').join('') + '</tbody></table></article>').join('')
        : '<p class="empty">' + (query ? 'No matching active states.' : 'No active states yet. Opening this panel does not instantiate lazy state.') + '</p>'
      activeRoot.innerHTML = activeHTML
      renderKnown(knownStates, query)
      pagination.hidden = pages <= 1
      previous.disabled = page === 0
      next.disabled = page >= pages - 1
      pageLabel.textContent = 'Page ' + (page + 1) + ' of ' + pages
    }
    const refresh = async () => {
      if (!visible || refreshing) return
      refreshing = true
      const query = search()
      const requestedPage = page
      try {
        const host = window.parent.__NUXT_DEVTOOLS_HOST__
        if (!host?.nuxt) throw new Error('Nuxt DevTools host is not connected.')
        const request = { query, page: requestedPage, result: undefined }
        await host.nuxt.callHook('nuxt-state:inspect', request)
        if (!visible || query !== search() || requestedPage !== page) return
        const { active = [], known = [], total = 0, pageSize = 1 } = request.result || {}
        pages = Math.max(1, Math.ceil(total / pageSize))
        if (page >= pages) {
          page = pages - 1
          return
        }
        render(active, known, query)
      } catch (error) {
        if (visible && query === search() && requestedPage === page) {
          activeRoot.innerHTML = '<p class="error">' + escapeHTML(error?.message || error) + '</p>'
          knownRoot.replaceChildren()
          previousKnown = undefined
          pagination.hidden = true
        }
      } finally {
        refreshing = false
        if (query !== search() || requestedPage !== page) refresh()
      }
    }
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting)
      if (visible) refresh()
    })
    observer.observe(document.documentElement)
    filter.addEventListener('input', () => { page = 0; refresh() })
    previous.addEventListener('click', () => { if (page > 0) { page--; refresh() } })
    next.addEventListener('click', () => { if (page + 1 < pages) { page++; refresh() } })
    document.querySelector('#refresh').addEventListener('click', refresh)
    const timer = setInterval(refresh, 1000)
    addEventListener('pagehide', () => { clearInterval(timer); observer.disconnect() }, { once: true })
    refresh()
  </script>
</body>
</html>`
}
