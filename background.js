chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCaptureFromWebsite') {
    chrome.tabs.create({ url: request.url }, (newTab) => {
      const onUpdated = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          
          setTimeout(async () => {
            try {
              const captureData = await capturePage(newTab, request.url);
              
              if (!captureData || captureData.error) {
                console.error('Capture failed:', captureData?.error || 'No data');
                sendResponse({ 
                  success: false, 
                  error: captureData?.error || 'Capture failed' 
                });
                chrome.tabs.remove(newTab.id);
                return;
              }
              
              const responseData = {
                metadata: captureData.metadata,
                screenshot: captureData.screenshot,
                mhtml: captureData.mhtml
              };
              
              sendResponse({ 
                success: true, 
                data: responseData,
                type: 'WEBSITE_GENERATE_SINGLE'
              });
              
              setTimeout(() => {
                chrome.tabs.remove(newTab.id);
              }, 500);
            } catch (error) {
              console.error('Capture error:', error);
              sendResponse({ 
                success: false, 
                error: error.message 
              });
              chrome.tabs.remove(newTab.id);
            }
          }, 1000);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
    return true;
  }

  if (request.action === "startCapture") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab) {
          throw new Error("No active tab found");
        }
  
        await new Promise((resolve) => {
          const onUpdated = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onUpdated);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(onUpdated);
          
          if (tab.status === 'complete') resolve();
        });
  
        await new Promise(resolve => setTimeout(resolve, 500));
  
        const captureData = await capturePage(tab);

        // const screenshotBase64 = await blobToBase64(captureData.screenshot);
        // const mhtmlBase64 = await blobToBase64(captureData.mhtml);

        const storableCapture = {
          screenshot: captureData.screenshot,
          mhtml: captureData.mhtml,
          metadata: captureData.metadata
        };

        const websiteTabs = await chrome.tabs.query({
          url: "http://localhost:5173/*",
        });

        if (websiteTabs.length > 0) {
          // const screenshotBlob = await base64ToBlob(screenshotBase64, 'image/png');
          // const mhtmlBlob = await base64ToBlob(mhtmlBase64, 'application/x-mimearchive');
          
          await chrome.tabs.sendMessage(websiteTabs[0].id, {
            type: "PAGE_CAPTURE_DATA",
            data: [{
              screenshot: captureData.screenshot,
              mhtml: captureData.mhtml,
              metadata: captureData.metadata
            }],
          });
        } else {
          const result = await chrome.storage.local.get(["captures"]);
          const existingCaptures = result.captures || [];
          await chrome.storage.local.set({
            captures: [...existingCaptures, storableCapture],
          });
          console.log("Capture stored:", captureData.metadata.url);
        }

        sendResponse({ success: true });
      } catch (error) {
        console.error("Capture failed:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.type === "REQUEST_CAPTURES") {
    (async () => {
      try {
        const result = await chrome.storage.local.get(["captures"]);
        const captures = result.captures || [];
  
        if (captures.length > 0) {
          const blobCaptures = await Promise.all(captures.map(async capture => {
            return {
              screenshot: capture.screenshot,//await base64ToBlob(capture.screenshot, 'image/png'),
              mhtml: capture.mhtml, //await base64ToBlob(capture.mhtml, 'application/x-mimearchive'),
              metadata: capture.metadata
            };
          }));
  
          await chrome.storage.local.remove("captures");
          sendResponse({
            type: "PAGE_CAPTURE_DATA",
            data: blobCaptures,
          });
        } else {
          sendResponse({ type: "PAGE_CAPTURE_DATA", data: [] });
        }
      } catch (error) {
        console.error("Failed to retrieve captures:", error);
        sendResponse({ type: "PAGE_CAPTURE_DATA", data: [], error: error.message });
      }
    })();
    return true;
  }
});

async function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

async function base64ToBlob(base64, mimeType) {
  const res = await fetch(`data:${mimeType};base64,${base64}`);
  return await res.blob();
}

async function capturePage(tab, explicitUrl = null) {
  try {
    const screenshotDataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(
        tab.windowId,
        { format: "png" },
        (dataUrl) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(dataUrl);
          }
        }
      );
    });

    const mhtmlBlob = await new Promise((resolve, reject) => {
      chrome.pageCapture.saveAsMHTML({ tabId: tab.id }, (blob) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(blob);
        }
      });
    });

    const mhtmlContent = await mhtmlBlob.text();
    const metadata = {
      ...extractMetadata(mhtmlContent, tab.url || explicitUrl, tab.title),
      timestamp: Date.now(),
    };
    // const screenshotBlob = await fetch(screenshotDataUrl).then(r => r.blob());
    // const mhtmlUrl = "data:application/x-mimearchive;base64," + btoa(mhtmlContent);

    return {
      screenshot: screenshotDataUrl,
      mhtml: mhtmlContent,
      metadata,
    };
  } catch (error) {
    console.error("Error in capturePage:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

function cleanMHTMLContent(text) {
  if (!text) return "";
  return text
    .replace(/=\s+/g, "")
    .replace(/=3D/g, "=")
    .replace(/=([0-9A-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetadata(mhtmlContent, tabUrl = "", tabTitle = "") {
  const cleanedContent = cleanMHTMLContent(mhtmlContent);

  const extractMeta = (name, attribute = "name") => {
    const regex = new RegExp(
      `<meta\\s+${attribute}=["']?${name}["']?\\s+content=["']([^"']*)["']`,
      "i"
    );
    const match = cleanedContent.match(regex);
    return match ? cleanMHTMLContent(match[1]) : "";
  };

  let title = tabTitle || "";
  let description = extractMeta("description") || "";
  const ogTitle = extractMeta("og:title", "property");
  const ogDescription = extractMeta("og:description", "property");

  const titleMatch = cleanedContent.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) {
    const pageTitle = cleanMHTMLContent(titleMatch[1]);
    title = title || pageTitle;
  }

  // Fallback: if no title or description, use Open Graph ones
  if (!title && ogTitle) title = ogTitle;
  if (!description && ogDescription) description = ogDescription;

  const keywords = extractMeta("keywords")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    url: tabUrl || null,
    title: title || null,
    description: description || null,
    keywords: keywords || null,
    timestamp: Date.now()
  };
}

