// Function to sort comments by likes in descending order
function sortComments(comments) {
  return comments.sort((a, b) => b.likes - a.likes);
}

// Function to clean filename
function cleanFileName(title) {
  const cleaned = title
    // Remove emojis and special characters
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    // Remove or replace invalid filename characters
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    // Replace multiple spaces with single space
    .replace(/\s+/g, ' ')
    // Remove any remaining non-ASCII characters
    .replace(/[^\x00-\x7F]/g, '')
    // Trim spaces from start and end
    .trim()
    // Limit length and add suffix if needed
    .slice(0, 100);

  // If cleaned title is empty, use default
  return (cleaned || 'youtube') + '_comments';
}

// Function to get video title
async function getVideoTitle(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Try multiple selectors to get the video title
        const titleElement = 
          document.querySelector('h1.ytd-video-primary-info-renderer') || // Main title
          document.querySelector('h1.title.ytd-video-primary-info-renderer') || // Alternative
          document.querySelector('h1 yt-formatted-string'); // Another alternative
        
        return titleElement ? titleElement.textContent : document.title.replace(' - YouTube', '');
      }
    });
    
    const title = results[0].result || 'youtube_comments';
    console.log('Got video title:', title); // Debug log
    return title;
  } catch (error) {
    console.error('Error getting video title:', error);
    return 'youtube_comments';
  }
}

// Function to export comments as structured text
async function exportComments(comments, tabId) {
  try {
    const videoTitle = await getVideoTitle(tabId);
    console.log('Original title:', videoTitle); // Debug log
    
    const cleanTitle = cleanFileName(videoTitle);
    console.log('Cleaned title:', cleanTitle); // Debug log
    
    const formattedComments = comments.map(comment => 
      `Comment: ${comment.text}\nLikes: ${comment.likes}\n`
    ).join('\n');
    
    // Create a data URL instead of a blob URL
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(formattedComments);
    
    const downloadOptions = {
      url: dataUrl,
      filename: `${cleanTitle}.txt`,
      saveAs: true
    };
    
    console.log('Download options:', downloadOptions); // Debug log
    
    await chrome.downloads.download(downloadOptions);
    return true;
  } catch (error) {
    console.error('Export error:', error);
    throw new Error('Failed to export comments: ' + (error.message || 'Unknown error'));
  }
}

// Handle popup requests with timeout and progress updates
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'popup') {
    let timeoutId;
    
    port.onMessage.addListener(msg => {
      if (msg.action === 'getComments') {
        // Set 60-second timeout
        timeoutId = setTimeout(() => {
          port.postMessage({ error: 'Operation timed out. Please refresh the page and try again.' });
          port.disconnect();
        }, 60000);

        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (!tabs[0]) {
            clearTimeout(timeoutId);
            port.postMessage({ error: 'No active YouTube tab found' });
            return;
          }

          // Send progress update
          port.postMessage({ progress: 'Connecting to YouTube page...' });

          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['content.js']
          }, () => {
            // Send progress update
            port.postMessage({ progress: 'Loading and extracting comments...' });

            chrome.tabs.sendMessage(tabs[0].id, { action: 'getComments', minLikes: msg.minLikes || 10 }, response => {
              clearTimeout(timeoutId);
              
              if (chrome.runtime.lastError) {
                port.postMessage({ error: 'Failed to extract comments. Please refresh the page and try again.' });
                return;
              }

              if (response && response.comments) {
                const filteredComments = response.comments;
                if (filteredComments.length > 0) {
                  const sortedComments = sortComments(filteredComments);
                  port.postMessage({ comments: sortedComments });
                } else {
                  port.postMessage({ comments: [] });
                }
              } else {
                port.postMessage({ error: 'No comments found or page not fully loaded' });
              }
            });
          });
        });
      }
    });

    // Cleanup on disconnect
    port.onDisconnect.addListener(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }
});

// Add message listener for export action
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exportComments' && request.comments) {
    // Get the current active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ 
          success: false, 
          error: 'Could not find active tab' 
        });
        return;
      }

      exportComments(request.comments, tabs[0].id)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch(error => {
          console.error('Export failed:', error);
          sendResponse({ 
            success: false, 
            error: error.message || 'Failed to export comments'
          });
        });
    });
    return true; // Keep the message channel open for async response
  } else if (request.action === 'openPopup') {
    chrome.action.openPopup();
    return true;
  }
});
