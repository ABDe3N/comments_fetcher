// Selector for YouTube comment elements
const COMMENT_SELECTOR = 'ytd-comment-thread-renderer';
const COMMENT_TEXT_SELECTOR = '#content-text';
const LIKE_COUNT_SELECTOR = '#vote-count-middle';
const COMMENTS_SECTION = 'ytd-comments';

// Function to inject the extract button
function injectExtractButton() {
  // Check if button already exists
  if (document.getElementById('yt-comment-extractor-btn')) {
    return;
  }

  // Find the actions container (next to subscribe button)
  const targetContainer = document.querySelector('#top-level-buttons-computed');
  if (!targetContainer) return;

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: inline-flex;
    align-items: center;
    margin-left: 8px;
  `;

  // Create the button
  const extractButton = document.createElement('button');
  extractButton.id = 'yt-comment-extractor-btn';
  extractButton.style.cssText = `
    background-color: transparent;
    color: #0f0f0f;
    border: none;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Roboto', sans-serif;
    transition: all 0.2s;
  `;

  // Add icon and text
  const iconImg = document.createElement('img');
  iconImg.src = chrome.runtime.getURL('icons/icon16.png');
  iconImg.style.cssText = `
    width: 16px;
    height: 16px;
    vertical-align: middle;
  `;
  
  const buttonText = document.createElement('span');
  buttonText.textContent = 'Extract Comments';
  
  extractButton.appendChild(iconImg);
  extractButton.appendChild(buttonText);

  // Add hover effect
  extractButton.onmouseover = () => {
    extractButton.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
  };
  extractButton.onmouseout = () => {
    extractButton.style.backgroundColor = 'transparent';
  };

  // Add click handler
  extractButton.onclick = () => {
    chrome.runtime.sendMessage({ action: 'openPopup' });
  };

  // Add button to container and inject into page
  buttonContainer.appendChild(extractButton);
  targetContainer.appendChild(buttonContainer);
}

// Watch for page navigation (YouTube is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('youtube.com/watch')) {
      // Wait for elements to load
      setTimeout(injectExtractButton, 2000);
    }
  }
}).observe(document, { subtree: true, childList: true });

// Initial injection
if (location.href.includes('youtube.com/watch')) {
  // Wait for elements to load
  setTimeout(injectExtractButton, 2000);
}

// Function to scroll and load comments
async function scrollAndLoadComments() {
  const commentsSection = document.querySelector(COMMENTS_SECTION);
  if (!commentsSection) {
    throw new Error('Comments section not found');
  }

  // Scroll to comments section to trigger loading
  commentsSection.scrollIntoView();
  
  let previousCommentCount = 0;
  let sameCountTimes = 0;
  let attempts = 0;
  
  while (attempts < 10) { // Try up to 10 times
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const currentComments = document.querySelectorAll(COMMENT_SELECTOR);
    const currentCount = currentComments.length;
    
    if (currentCount > 0) {
      if (currentCount === previousCommentCount) {
        sameCountTimes++;
        if (sameCountTimes >= 3) { // If count stays same for 3 seconds, assume loading complete
          return;
        }
      } else {
        sameCountTimes = 0;
      }
    }
    
    previousCommentCount = currentCount;
    attempts++;
    
    // Scroll more to load additional comments
    window.scrollTo(0, window.scrollY + 1000);
  }
}

// Function to clean text of unwanted characters
function cleanText(text) {
  return text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
             .trim();
}

// Function to extract comments from the page
async function extractComments(minLikes = 10) {
  try {
    // First scroll and load comments
    await scrollAndLoadComments();

    const comments = [];
    const commentElements = document.querySelectorAll(COMMENT_SELECTOR);
    
    if (commentElements.length === 0) {
      throw new Error('No comments found on the page');
    }

    console.log(`Found ${commentElements.length} comments`);

    commentElements.forEach(commentElement => {
      const textElement = commentElement.querySelector(COMMENT_TEXT_SELECTOR);
      const likeElement = commentElement.querySelector(LIKE_COUNT_SELECTOR);
      
      if (textElement && likeElement) {
        const text = cleanText(textElement.textContent);
        const likesText = likeElement.textContent.trim();
        // Handle both "1.2K" format and regular numbers
        const likes = likesText.toLowerCase().includes('k') 
          ? Math.round(parseFloat(likesText.replace(/k/i, '')) * 1000)
          : parseInt(likesText.replace(/[^0-9]/g, '')) || 0;
        
        if (likes >= minLikes) {
          comments.push({
            text: text,
            likes: likes
          });
        }
      }
    });

    console.log(`Filtered to ${comments.length} comments with >=${minLikes} likes`);
    return comments;
  } catch (error) {
    console.error('Error extracting comments:', error);
    throw error;
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getComments') {
    extractComments(request.minLikes || 10)
      .then(comments => {
        sendResponse({ comments: comments });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true; // Required for async response
  }
});
