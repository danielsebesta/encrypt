(function () {
  var alertRoot = document.getElementById('integrity-alert');
  if (!alertRoot || !window.crypto || !crypto.subtle) return;

  var titleEl = alertRoot.querySelector('[data-integrity-title]');
  var messageEl = alertRoot.querySelector('[data-integrity-message]');
  var linksEl = alertRoot.querySelector('[data-integrity-links]');
  var dismissButton = alertRoot.querySelector('[data-integrity-dismiss]');
  var repo = alertRoot.getAttribute('data-repo') || 'danielsebesta/encrypt';
  var branch = alertRoot.getAttribute('data-branch') || 'main';
  var repoUrl = 'https://github.com/' + repo;

  function copy(key) {
    return alertRoot.getAttribute('data-' + key) || '';
  }

  function shortSha(sha) {
    return sha ? sha.slice(0, 12) : 'unknown';
  }

  function cacheBust(url) {
    var next = new URL(url, location.origin);
    next.searchParams.set('ec_integrity', String(Date.now()));
    return next.href;
  }

  async function fetchBytes(url) {
    var response = await fetch(cacheBust(url), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: '*/*' },
    });
    if (!response.ok) throw new Error('Fetch failed for ' + url);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function hashBytes(bytes) {
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function currentAssetPaths(manifest) {
    var nodes = document.querySelectorAll('script[src],link[rel="stylesheet"][href],astro-island[component-url],astro-island[renderer-url]');
    var paths = [];
    var files = (manifest && manifest.files) || {};

    nodes.forEach(function (node) {
      var attr = 'src';
      if (node.tagName === 'LINK') attr = 'href';
      else if (node.tagName === 'ASTRO-ISLAND') {
        ['component-url', 'renderer-url'].forEach(function (islandAttr) {
          var raw = node.getAttribute(islandAttr);
          if (!raw) return;
          var islandUrl = new URL(raw, location.origin);
          if (
            islandUrl.origin === location.origin &&
            files[islandUrl.pathname] &&
            paths.indexOf(islandUrl.pathname) === -1
          ) {
            paths.push(islandUrl.pathname);
          }
        });
        return;
      }

      var url = new URL(node.getAttribute(attr), location.origin);
      // Only verify files from this build. Skip Cloudflare (/cdn-cgi) and other injections.
      if (
        url.origin === location.origin &&
        files[url.pathname] &&
        paths.indexOf(url.pathname) === -1
      ) {
        paths.push(url.pathname);
      }
    });

    return paths;
  }

  async function verifyFile(manifest, publicPath, fetchPath) {
    var expected = manifest.files && manifest.files[publicPath];
    if (!expected) {
      throw new Error('Missing manifest entry for ' + publicPath);
    }

    var actualHash = await hashBytes(await fetchBytes(fetchPath || publicPath));
    if (actualHash !== expected.sha256) {
      throw new Error('Hash mismatch for ' + publicPath);
    }
  }

  async function githubHeadSha() {
    var response = await fetch('https://api.github.com/repos/' + repo + '/commits/' + branch, {
      cache: 'no-store',
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error('GitHub commit lookup failed');
    var payload = await response.json();
    if (!payload || !payload.sha) throw new Error('GitHub commit response missing sha');
    return payload.sha;
  }

  function link(label, href) {
    if (!href) return null;
    var anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = label;
    return anchor;
  }

  function showAlert(type, title, message, items) {
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    alertRoot.classList.remove('hidden', 'integrity-alert--warning', 'integrity-alert--danger');
    alertRoot.classList.add(type === 'danger' ? 'integrity-alert--danger' : 'integrity-alert--warning');

    if (linksEl) {
      linksEl.textContent = '';
      (items || []).filter(Boolean).forEach(function (item) {
        linksEl.appendChild(item);
      });
    }
  }

  function commitLink(sha) {
    return sha ? repoUrl + '/commit/' + sha : '';
  }

  async function run() {
    var manifest = await (async function () {
      var response = await fetch(cacheBust('/build-integrity.json'), {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Build manifest unavailable');
      return response.json();
    })();

    var deployedSha = manifest.commitSha || '';
    var latestSha = '';
    var githubUnavailable = false;

    try {
      latestSha = await githubHeadSha();
    } catch {
      githubUnavailable = true;
    }

    // Verify only build-manifest assets. Ignore HTML and Cloudflare /cdn-cgi injections.
    var assets = currentAssetPaths(manifest);
    for (var i = 0; i < assets.length; i += 1) {
      await verifyFile(manifest, assets[i]);
    }

    if (latestSha && deployedSha && latestSha !== deployedSha) {
      showAlert(
        'danger',
        copy('mismatch-title'),
        copy('mismatch-message'),
        [
          link(copy('deployed-label') + ': ' + shortSha(deployedSha), commitLink(deployedSha)),
          link(copy('latest-label') + ': ' + shortSha(latestSha), commitLink(latestSha)),
          link(copy('repo-label'), repoUrl),
        ],
      );
      return;
    }

    if (githubUnavailable) {
      showAlert(
        'warning',
        copy('unavailable-title'),
        copy('unavailable-message'),
        [
          link(copy('deployed-label') + ': ' + shortSha(deployedSha), commitLink(deployedSha)),
          link(copy('repo-label'), repoUrl),
        ],
      );
    }
  }

  if (dismissButton) {
    dismissButton.addEventListener('click', function () {
      alertRoot.classList.add('hidden');
    });
  }

  run().catch(function () {
    showAlert(
      'danger',
      copy('asset-title'),
      copy('asset-message'),
      [link(copy('repo-label'), repoUrl)],
    );
  });
})();
