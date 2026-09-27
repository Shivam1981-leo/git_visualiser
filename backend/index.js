const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

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

const getAuthHeaders = () => {
    if (process.env.GITHUB_TOKEN) {
        return { Authorization: `token ${process.env.GITHUB_TOKEN}` };
    }
    return {};
};

app.post('/api/repo/clone', async (req, res) => {
  const { url, sessionId } = req.body;
  if (!url || !sessionId) {
    return res.status(400).json({ error: 'Repo URL and sessionId are required' });
  }

  const repoPath = parseGitHubUrl(url);
  if (!repoPath) {
      return res.status(400).json({ error: 'Only GitHub repository URLs are supported in this mode.' });
  }

  try {
    // Verify the repo exists
    await axios.get(`https://api.github.com/repos/${repoPath}`, { headers: getAuthHeaders() });
    res.json({ message: 'Repository connected successfully', name: repoPath, sessionId });
  } catch (error) {
    console.error('Error connecting repo:', error.message);
    res.status(500).json({ error: 'Failed to connect to repository', details: error.message });
  }
});

app.get('/api/repo/commits', async (req, res) => {
  const { repoName } = req.query;
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${repoName}/commits`, { headers: getAuthHeaders() });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch commits' });
  }
});

app.get('/api/repo/graph', async (req, res) => {
    const { repoName } = req.query;
    if (!repoName) return res.status(400).json({ error: 'Repo name is required' });

    try {
        // Fetch last 100 commits (reduces payload and visual clutter)
        const commitsRes = await axios.get(`https://api.github.com/repos/${repoName}/commits?per_page=100`, { headers: getAuthHeaders() });
        const commits = commitsRes.data;
        
        let branches = [];
        try {
            const branchesRes = await axios.get(`https://api.github.com/repos/${repoName}/branches?per_page=100`, { headers: getAuthHeaders() });
            branches = branchesRes.data;
        } catch (e) {
            console.error('Failed to fetch branches, ignoring refs', e.message);
        }

        const nodes = [];
        const edges = [];
        
        commits.forEach(commitObj => {
            const hash = commitObj.sha;
            const message = commitObj.commit.message.split('\n')[0];
            const author = commitObj.commit.author.name || commitObj.author?.login || 'Unknown';
            const date = commitObj.commit.author.date;
            
            const refsList = branches.filter(b => b.commit.sha === hash).map(b => b.name);
            const refs = refsList.length > 0 ? `(HEAD -> ${refsList.join(', ')})` : '';

            nodes.push({
                id: hash,
                data: { label: message, hash, author, refs, date },
            });
            
            commitObj.parents.forEach(parent => {
                edges.push({
                    id: `e-${hash}-${parent.sha}`,
                    source: parent.sha,
                    target: hash,
                });
            });
        });
        
        res.json({ nodes, edges });
    } catch (error) {
        console.error('Error fetching graph:', error.message);
        res.status(500).json({ error: 'Failed to fetch graph' });
    }
});

app.get('/api/repo/contributors', async (req, res) => {
    const { repoName } = req.query;
    if (!repoName) return res.status(400).json({ error: 'Repo name is required' });

    try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoName}/contributors?per_page=15`, { headers: getAuthHeaders() });
        const contributors = data.map(c => ({
            name: c.login || 'Unknown',
            commits: c.contributions
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
    
    try {
        const commitRes = await axios.get(`https://api.github.com/repos/${repoName}/commits/${hash}`, { headers: getAuthHeaders() });
        const files = commitRes.data.files || [];
        const summary = files.map(f => ` ${f.filename} | ${f.changes} + -`).join('\n');
        
        const diffRes = await axios.get(`https://api.github.com/repos/${repoName}/commits/${hash}`, { 
            headers: { ...getAuthHeaders(), Accept: 'application/vnd.github.v3.diff' } 
        });
        const diffFull = diffRes.data;
        
        res.json({ summary: summary || 'No files changed', diff: diffFull });
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
