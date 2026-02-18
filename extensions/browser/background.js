let port = null
let reconnectTimeout = null
let reconnectDelay = 5000

function connect() {
  try {
    port = chrome.runtime.connectNative('com.vicu.browser')
    reconnectDelay = 5000 // reset on successful connect

    port.onDisconnect.addListener(() => {
      port = null
      scheduleReconnect()
    })

    // Send current tab on connect
    sendCurrentTab()
  } catch {
    port = null
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout)
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 10000)
}

function isInternalUrl(url) {
  if (!url) return true
  return /^(chrome|chrome-extension|about|edge|moz-extension|brave):\/\//i.test(url)
}

function sendMessage(msg) {
  if (port) {
    try { port.postMessage(msg) } catch { port = null }
  }
}

function sendCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
      sendMessage({ type: 'clear' })
      return
    }
    const tab = tabs[0]
    if (!tab.url || isInternalUrl(tab.url)) {
      sendMessage({ type: 'clear' })
    } else {
      sendMessage({ type: 'tab', url: tab.url, title: tab.title || '' })
    }
  })
}

chrome.tabs.onActivated.addListener(() => sendCurrentTab())

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title) {
    // Only care about active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id === tabId) {
        sendCurrentTab()
      }
    })
  }
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    sendMessage({ type: 'clear' })
  } else {
    sendCurrentTab()
  }
})

connect()
