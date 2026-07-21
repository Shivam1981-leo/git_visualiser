const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Base directory to store cloned repos temporarily
const REPOS_DIR = path.join(__dirname, 'temp_repos');
if (!fs.existsSync(REPOS_DIR)) {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
}

// In-memory state for current repo path
let currentRepoPath = null;
let git = null;

// Helper to clear temporary repos
const clearTempRepos = () => {
  if (fs.existsSync(REPOS_DIR)) {
    fs.rmSync(REPOS_DIR, { recursive: true, force: true });
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }
};

app.post('/api/repo/clone', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Repo URL is required' });
  }

  try {
    clearTempRepos();
    const repoName = url.split('/').pop().replace('.git', '');
    const clonePath = path.join(REPOS_DIR, repoName);
    
    // Initialize simple-git
    const baseGit = simpleGit();
    
    console.log(`Cloning ${url} to ${clonePath}...`);
    await baseGit.clone(url, clonePath);
    console.log('Cloned successfully.');

    currentRepoPath = clonePath;
    git = simpleGit(currentRepoPath);

    res.json({ message: 'Repository cloned successfully', name: repoName });
  } catch (error) {
    console.error('Error cloning repo:', error);
    res.status(500).json({ error: 'Failed to clone repository', details: error.message });
  }
});

app.get('/api/repo/commits', async (req, res) => {
  if (!git) {
    return res.status(400).json({ error: 'No repository currently loaded' });
  }

  try {
    const logOptions = {
      '--all': null,
    };
    const log = await git.log(logOptions);
    res.json(log.all);
  } catch (error) {
    console.error('Error fetching commits:', error);
    res.status(500).json({ error: 'Failed to fetch commits' });
  }
});

app.get('/api/repo/graph', async (req, res) => {
    if (!git) return res.status(400).json({ error: 'No repository currently loaded' });
    try {
        const log = await git.log(['--all']);
        
        // simple-git log object includes hash, date, message, refs, body, author_name, author_email
        // We will transform this into nodes and edges for React Flow
        const nodes = [];
        const edges = [];
        
        // We need parent hashes to build edges
        const logWithParents = await git.raw(['log', '--all', '--pretty=format:%H|%P|%an|%s|%d|%ad']);
        const lines = logWithParents.split('\n').filter(Boolean);
        
        lines.forEach((line, index) => {
            const [hash, parentsRaw, author, message, refs, date] = line.split('|');
            const parents = parentsRaw ? parentsRaw.split(' ') : [];
            
            nodes.push({
                id: hash,
                data: { label: message, hash, author, refs, date },
            });
            
            parents.forEach(parent => {
                if (parent) {
                    edges.push({
                        id: `e-${hash}-${parent}`,
                        source: parent, // Parent to child (or child to parent depending on flow direction)
                        target: hash,
                    });
                }
            });
        });
        
        res.json({ nodes, edges });
    } catch (error) {
        console.error('Error fetching graph:', error);
        res.status(500).json({ error: 'Failed to fetch graph' });
    }
});

app.get('/api/repo/contributors', async (req, res) => {
  if (!git) return res.status(400).json({ error: 'No repository currently loaded' });

  try {
    // get shortlog to count commits
    const shortlog = await git.raw(['shortlog', '-s', '-n', '--all']);
    const contributors = shortlog.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.trim().split('\t');
        return { name: parts[1], commits: parseInt(parts[0], 10) };
      });

    res.json(contributors);
  } catch (error) {
    console.error('Error fetching contributors:', error);
    res.status(500).json({ error: 'Failed to fetch contributors' });
  }
});

app.get('/api/repo/diff/:hash', async (req, res) => {
    if (!git) return res.status(400).json({ error: 'No repository currently loaded' });
    
    try {
        const hash = req.params.hash;
        const diffSummary = await git.show(['--stat', hash]);
        const diffFull = await git.show([hash]);
        res.json({ summary: diffSummary, diff: diffFull });
    } catch (error) {
        console.error('Error fetching diff:', error);
        res.status(500).json({ error: 'Failed to fetch diff' });
    }
});


app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
