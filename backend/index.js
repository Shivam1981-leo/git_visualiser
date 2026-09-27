require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Helper to extract owner/repo from GitHub URL
const parseGitHubUrl = (url) => {
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname !== 'github.com') return null;
        let pathname = urlObj.pathname.replace(/^\/|\/$/g, '');
        if (pathname.endsWith('.git')) pathname = pathname.slice(0, -4);
        const parts = pathname.split('/');
        if (parts.length >= 2) {
            return `${parts[0]}/${parts[1]}`;
        }
    } catch (e) {
        const match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
        if (match) return `${match[1]}/${match[2]}`;
    }
    return null;
};

// Retrieve token from request header (passed from frontend) or fallback to server env token
const getAuthHeaders = (req) => {
    const authHeader = req ? req.headers.authorization : null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return { Authorization: authHeader };
    }
    if (process.env.GITHUB_TOKEN) {
        return { Authorization: `token ${process.env.GITHUB_TOKEN}` };
    }
    return {};
};

// --- OAuth Endpoints ---
app.get('/api/auth/github', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
        return res.status(500).json({ error: 'GitHub OAuth is not configured on the server.' });
    }
    // redirect to GitHub
    const redirectUri = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo`;
    res.redirect(redirectUri);
});

app.get('/api/auth/github/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code provided');

    try {
        // Exchange code for access token
        const response = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code
        }, {
            headers: { Accept: 'application/json' }
        });

        const accessToken = response.data.access_token;
        if (!accessToken) throw new Error('Failed to get access token');

        // Redirect back to frontend with the token
        res.redirect(`${FRONTEND_URL}?token=${accessToken}`);
    } catch (error) {
        console.error('OAuth Callback Error:', error.message);
        res.redirect(`${FRONTEND_URL}?error=oauth_failed`);
    }
});


// --- User Info Endpoint ---
app.get('/api/auth/user', async (req, res) => {
    try {
        const headers = getAuthHeaders(req);
        if (!headers.Authorization) return res.status(401).json({ error: 'Not authenticated' });
        
        const { data } = await axios.get('https://api.github.com/user', { headers });
        res.json({
            name: data.name || data.login,
            login: data.login,
            avatar_url: data.avatar_url,
            html_url: data.html_url
        });
    } catch (e) {
        res.status(401).json({ error: 'Failed to fetch user profile' });
    }
});

// --- Repo Endpoints ---
app.get('/api/repo/info', async (req, res) => {
    const { repoName } = req.query;
    if (!repoName) return res.status(400).json({ error: 'Repo name is required' });
    try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoName}`, { headers: getAuthHeaders(req) });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch repo info' });
    }
});

// File Explorer Endpoints
app.get('/api/repo/tree', async (req, res) => {
    const { repoName, branch } = req.query;
    try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoName}/git/trees/${branch}?recursive=1`, { headers: getAuthHeaders(req) });
        res.json(data.tree);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch repo tree' });
    }
});

app.get('/api/repo/file', async (req, res) => {
    const { repoName, path } = req.query;
    try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoName}/contents/${path}`, { headers: getAuthHeaders(req) });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch file' });
    }
});

// Pull Requests Endpoint
app.get('/api/repo/prs', async (req, res) => {
    const { repoName } = req.query;
    try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoName}/pulls?state=all&per_page=30`, { headers: getAuthHeaders(req) });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch PRs' });
    }
});

app.post('/api/repo/clone', async (req, res) => {
  const { url, sessionId } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Repo URL is required' });
  }

  const repoPath = parseGitHubUrl(url);
  if (!repoPath) {
      return res.status(400).json({ error: 'Only GitHub repository URLs are supported in this mode.' });
  }

  try {
    // Verify the repo exists using user's token if available
    await axios.get(`https://api.github.com/repos/${repoPath}`, { headers: getAuthHeaders(req) });
    res.json({ message: 'Repository connected successfully', name: repoPath, sessionId });
  } catch (error) {
    console.error('Error connecting repo:', error.message);
    if (error.response && error.response.status === 404) {
        res.status(404).json({ error: 'Repository not found. If it is private, please Login with GitHub.' });
    } else {
        res.status(500).json({ error: 'Failed to connect to repository', details: error.message });
    }
  }
});

app.get('/api/repo/graph', async (req, res) => {
    const { repoName } = req.query;
    if (!repoName) return res.status(400).json({ error: 'Repo name is required' });

    try {
        const headers = getAuthHeaders(req);
        
        // Parallel requests for commits and branches to speed up
        // Fetching up to 300 commits for a deeper history graph
        const fetchCommits = async () => {
            const [p1, p2, p3] = await Promise.allSettled([
                axios.get(`https://api.github.com/repos/${repoName}/commits?per_page=100&page=1`, { headers }),
                axios.get(`https://api.github.com/repos/${repoName}/commits?per_page=100&page=2`, { headers }),
                axios.get(`https://api.github.com/repos/${repoName}/commits?per_page=100&page=3`, { headers })
            ]);
            let allCommits = [];
            if (p1.status === 'fulfilled') allCommits.push(...p1.value.data);
            if (p2.status === 'fulfilled') allCommits.push(...p2.value.data);
            if (p3.status === 'fulfilled') allCommits.push(...p3.value.data);
            return allCommits;
        };

        const [commits, branchesRes] = await Promise.all([
            fetchCommits(),
            axios.get(`https://api.github.com/repos/${repoName}/branches?per_page=100`, { headers }).catch(() => ({ data: [] }))
        ]);
        
        const branches = branchesRes.data || [];

        const nodes = [];
        const edges = [];
        const commitDates = {};
        
        commits.forEach(commitObj => {
            const hash = commitObj.sha;
            const message = commitObj.commit.message.split('\n')[0];
            const author = commitObj.commit.author.name || commitObj.author?.login || 'Unknown';
            const date = commitObj.commit.author.date;
            
            // For analytics
            const day = date.split('T')[0];
            commitDates[day] = (commitDates[day] || 0) + 1;
            
            const refsList = branches.filter(b => b.commit.sha === hash).map(b => b.name);
            const refs = refsList.length > 0 ? `(HEAD -> ${refsList.join(', ')})` : '';

            nodes.push({
                id: hash,
                data: { label: message, hash, author, refs, date },
            });
            
            commitObj.parents.forEach(parent => {
                // Only add edge if we actually fetched the parent node, to avoid dangling edges in the graph
                if (commits.some(c => c.sha === parent.sha)) {
                    edges.push({
                        id: `e-${hash}-${parent.sha}`,
                        source: parent.sha,
                        target: hash,
                    });
                }
            });
        });
        
        // Prepare analytics data
        const analytics = Object.entries(commitDates)
            .sort((a, b) => new Date(a[0]) - new Date(b[0]))
            .map(([date, count]) => ({ date, commits: count }));

        res.json({ nodes, edges, analytics });
    } catch (error) {
        console.error('Error fetching graph:', error.message);
        res.status(500).json({ error: 'Failed to fetch graph' });
    }
});

app.get('/api/repo/contributors', async (req, res) => {
    const { repoName } = req.query;
    if (!repoName) return res.status(400).json({ error: 'Repo name is required' });

    try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoName}/contributors?per_page=15`, { headers: getAuthHeaders(req) });
        const contributors = data.map(c => ({
            name: c.login || 'Unknown',
            commits: c.contributions,
            profileUrl: c.html_url,
            avatarUrl: c.avatar_url
        }));
        res.json(contributors);
    } catch (error) {
        console.error('Error fetching contributors:', error.message);
        res.status(500).json({ error: 'Failed to fetch contributors' });
    }
});

app.get('/api/repo/diff/:hash', async (req, res) => {
    const { repoName } = req.query;
    const hash = req.params.hash;
    const headers = getAuthHeaders(req);
    
    try {
        const [commitRes, diffRes] = await Promise.all([
            axios.get(`https://api.github.com/repos/${repoName}/commits/${hash}`, { headers }),
            axios.get(`https://api.github.com/repos/${repoName}/commits/${hash}`, { 
                headers: { ...headers, Accept: 'application/vnd.github.v3.diff' } 
            })
        ]);

        const files = commitRes.data.files || [];
        const summary = files.map(f => ` ${f.filename} | ${f.changes} + -`).join('\n');
        
        res.json({ summary: summary || 'No files changed', diff: diffRes.data });
    } catch (error) {
        console.error('Error fetching diff:', error.message);
        res.status(500).json({ error: 'Failed to fetch diff' });
    }
});

app.delete('/api/repo/session', (req, res) => {
    res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
