document.addEventListener('DOMContentLoaded', function() {
  const extractBtn = document.getElementById('extractBtn');
  const exportBtn = document.getElementById('exportBtn');
  const statusDiv = document.getElementById('status');
  const commentsList = document.getElementById('comments-list');
  const minLikesInput = document.getElementById('minLikes');
  let currentComments = [];

  // Load cached comments when popup opens
  function loadCachedComments() {
    chrome.tabs.query({ active: true, currentWindow: true }, tab => {
      const videoId = new URL(tab[0].url).searchParams.get('v');
      if (videoId) {
        chrome.storage.local.get(['comments_' + videoId, 'minLikes_' + videoId], (result) => {
          const cachedComments = result['comments_' + videoId];
          const cachedMinLikes = result['minLikes_' + videoId];
          
          if (cachedComments && cachedMinLikes) {
            currentComments = cachedComments;
            minLikesInput.value = cachedMinLikes;
            setStatus(`Showing ${cachedComments.length} cached comments`, 'success');
            displayComments(cachedComments, cachedMinLikes);
          }
        });
      }
    });
  }

  // Cache current comments
  function cacheComments(comments, minLikes) {
    chrome.tabs.query({ active: true, currentWindow: true }, tab => {
      const videoId = new URL(tab[0].url).searchParams.get('v');
      if (videoId) {
        chrome.storage.local.set({
          ['comments_' + videoId]: comments,
          ['minLikes_' + videoId]: minLikes
        });
      }
    });
  }

  function setStatus(message, type = 'loading') {
    statusDiv.textContent = message;
    statusDiv.className = type;
    
    if (type === 'loading') {
      statusDiv.innerHTML = `
        <div class="spinner"></div>
        <span>${message}</span>
      `;
    }
  }

  function formatLikes(likes) {
    if (likes >= 1000000) {
      return `${(likes / 1000000).toFixed(1)}M`;
    } else if (likes >= 1000) {
      return `${(likes / 1000).toFixed(1)}K`;
    }
    return likes.toString();
  }

  function displayComments(comments, minLikes) {
    if (comments.length === 0) {
      commentsList.innerHTML = `
        <div class="no-comments">
          No comments found with ${minLikes} or more likes
        </div>
      `;
      exportBtn.disabled = true;
    } else {
      commentsList.innerHTML = comments
        .map((comment, index) => {
          const cleanText = comment.text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '');
          return `
            <div class="comment-item">
              <div class="comment-text">${cleanText}</div>
              <div class="comment-footer">
                <div class="comment-likes">Likes: ${formatLikes(comment.likes)}</div>
                <button class="copy-btn" data-index="${index}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z" fill="currentColor"/>
                  </svg>
                  Copy
                </button>
              </div>
            </div>
          `;
        })
        .join('');
      exportBtn.disabled = false;

      // Add click handlers for copy buttons
      document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const index = e.currentTarget.dataset.index;
          const comment = comments[index];
          const textWithLikes = `${formatLikes(comment.likes)} - ${comment.text}`;
          
          try {
            await navigator.clipboard.writeText(textWithLikes);
            const originalText = btn.innerHTML;
            btn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" fill="currentColor"/>
              </svg>
              Copied!
            `;
            btn.classList.add('copied');
            
            setTimeout(() => {
              btn.innerHTML = originalText;
              btn.classList.remove('copied');
            }, 2000);
          } catch (err) {
            console.error('Failed to copy text:', err);
          }
        });
      });
    }
    
    commentsList.style.display = 'block';
  }

  extractBtn.addEventListener('click', () => {
    const minLikes = parseInt(minLikesInput.value) || 10;
    minLikesInput.value = minLikes;
    
    setStatus('Initializing comment extraction...');
    extractBtn.disabled = true;
    exportBtn.disabled = true;
    commentsList.style.display = 'none';
    currentComments = [];
    
    const port = chrome.runtime.connect({ name: 'popup' });
    
    port.postMessage({ 
      action: 'getComments',
      minLikes: minLikes
    });
    
    port.onMessage.addListener((msg) => {
      if (msg.progress) {
        setStatus(msg.progress);
      }
      else if (msg.comments) {
        currentComments = msg.comments;
        if (msg.comments.length > 0) {
          setStatus(`Found ${msg.comments.length} comments with ${minLikes}+ likes`, 'success');
          displayComments(msg.comments, minLikes);
          // Cache the comments
          cacheComments(msg.comments, minLikes);
        } else {
          setStatus(`No comments found with ${minLikes} or more likes`, 'error');
          displayComments([], minLikes);
        }
        extractBtn.disabled = false;
      }
      else if (msg.error) {
        setStatus(msg.error, 'error');
        extractBtn.disabled = false;
        exportBtn.disabled = true;
        commentsList.style.display = 'none';
        currentComments = [];
      }
    });
    
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        setStatus('Connection to background script failed', 'error');
        extractBtn.disabled = false;
        exportBtn.disabled = true;
        currentComments = [];
      }
    });
  });

  exportBtn.addEventListener('click', () => {
    if (currentComments.length > 0) {
      exportBtn.disabled = true;
      setStatus('Preparing to export comments...', 'loading');
      
      chrome.runtime.sendMessage(
        { 
          action: 'exportComments', 
          comments: currentComments 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Export error:', chrome.runtime.lastError);
            setStatus('Failed to export: ' + chrome.runtime.lastError.message, 'error');
            exportBtn.disabled = false;
            return;
          }
          
          if (response && response.success) {
            setStatus('Comments exported successfully!', 'success');
            setTimeout(() => {
              setStatus('Ready to extract comments');
            }, 3000);
          } else {
            const errorMsg = response?.error || 'Failed to export comments';
            console.error('Export failed:', errorMsg);
            setStatus(errorMsg, 'error');
          }
          exportBtn.disabled = false;
        }
      );
    }
  });

  // Load cached comments when popup opens
  loadCachedComments();
});
