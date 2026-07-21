const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Base directory to store cloned repos temporarily
const REPOS_DIR = path.join(__dirname, 'temp_repos');
if (!fs.existsSync(REPOS_DIR)) {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
}

// Cleanup function to delete session folders older than 1 hour
const cleanupOldSessions = () => {
  if (!fs.existsSync(REPOS_DIR)) return;
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  const sessions = fs.readdirSync(REPOS_DIR);
  sessions.forEach(session => {
    const sessionPath = path.join(REPOS_DIR, session);
    const stats = fs.statSync(sessionPath);
    if (now - stats.mtimeMs > ONE_HOUR) {
      console.log(`Cleaning up old session: ${session}`);
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
  });
};

const getGitInstance = (sessionId, repoName) => {
    if (!sessionId || !repoName) return null;
    const repoPath = path.join(REPOS_DIR, sessionId, repoName);
    if (!fs.existsSync(repoPath)) return null;
    return simpleGit(repoPath);
}

app.post('/api/repo/clone', async (req, res) => {
  const { url, sessionId } = req.body;
  if (!url || !sessionId) {
    return res.status(400).json({ error: 'Repo URL and sessionId are required' });
  }

  try {
    // Run background cleanup for disk space
    cleanupOldSessions();

    const repoName = url.split('/').pop().replace('.git', '');
    const sessionDir = path.join(REPOS_DIR, sessionId);
    const clonePath = path.join(sessionDir, repoName);
    
    // Clean specific session if exists to avoid conflicts on re-clone
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });
    
    // Initialize simple-git
    const baseGit = simpleGit();
    
    console.log(`[${sessionId}] Cloning ${url} to ${clonePath}...`);
    await baseGit.clone(url, clonePath);
    console.log(`[${sessionId}] Cloned successfully.`);

    res.json({ message: 'Repository cloned successfully', name: repoName, sessionId });
  } catch (error) {
    console.error('Error cloning repo:', error);
    res.status(500).json({ error: 'Failed to clone repository', details: error.message });
  }
});

app.get('/api/repo/commits', async (req, res) => {
  const { sessionId, repoName } = req.query;
  const git = getGitInstance(sessionId, repoName);
  if (!git) return res.status(400).json({ error: 'No repository currently loaded for this session' });

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
    const { sessionId, repoName } = req.query;
    const git = getGitInstance(sessionId, repoName);
    if (!git) return res.status(400).json({ error: 'No repository currently loaded for this session' });

    try {
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
                        source: parent,
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
    const { sessionId, repoName } = req.query;
    const git = getGitInstance(sessionId, repoName);
    if (!git) return res.status(400).json({ error: 'No repository currently loaded for this session' });

  try {
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
    const { sessionId, repoName } = req.query;
    const git = getGitInstance(sessionId, repoName);
    if (!git) return res.status(400).json({ error: 'No repository currently loaded for this session' });
    
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

app.delete('/api/repo/session', (req, res) => {
    const { sessionId } = req.query;
    if (sessionId) {
        const sessionDir = path.join(REPOS_DIR, sessionId);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    }
    res.json({ success: true });
});


app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
