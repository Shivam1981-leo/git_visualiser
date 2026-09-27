import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { 
    GitGraph, Download, X, GitCommit as GitCommitIcon, 
    GitPullRequest, LogIn, LogOut, Activity, 
    PieChart, Info, BookOpen, Star, GitFork, User, Search,
    Play, Pause, Sun, Moon, Folder, File, Code, GitMerge, CheckCircle, XCircle, ChevronRight
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { toPng } from 'html-to-image';
import CalendarHeatmap from 'react-calendar-heatmap';
import 'react-calendar-heatmap/dist/styles.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const API_BASE = RAW_API_BASE.replace(/\/repo\/?$/, '');

// Custom Node Component (GitHub Style)
const CommitNode = ({ data }) => {
  const refsRaw = data.refs ? data.refs.trim() : '';
  const refList = refsRaw.startsWith('(') && refsRaw.endsWith(')') 
    ? refsRaw.slice(1, -1).split(',').map(r => r.trim()).filter(Boolean)
    : [];

  let borderColor = 'var(--border-default)';
  let glowColor = 'transparent';
  if (refsRaw.includes('HEAD')) {
      borderColor = '#58a6ff'; glowColor = 'rgba(88, 166, 255, 0.3)';
  } else if (refsRaw.includes('feat') || refsRaw.includes('feature')) {
      borderColor = '#d2a8ff'; glowColor = 'rgba(210, 168, 255, 0.3)';
  } else if (refsRaw.includes('fix') || refsRaw.includes('bug')) {
      borderColor = '#f85149'; glowColor = 'rgba(248, 81, 73, 0.3)';
  } else if (refsRaw.includes('origin/')) {
      borderColor = '#3fb950'; glowColor = 'rgba(63, 185, 80, 0.3)';
  }

  const containerStyle = {
      opacity: data.isHidden ? 0 : (data.isDimmed ? 0.1 : 1),
      transform: data.isHighlighted ? 'scale(1.05)' : (data.isHidden ? 'scale(0.8)' : 'scale(1)'),
      borderColor: data.isHighlighted ? 'var(--link-color)' : borderColor,
      boxShadow: data.isHighlighted ? `0 0 20px var(--border-glow)` : `0 4px 12px rgba(0,0,0,0.2), 0 0 10px ${glowColor}`,
      zIndex: data.isHighlighted ? 10 : 1,
      pointerEvents: data.isHidden ? 'none' : 'auto',
      transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
  };

  return (
    <div className="commit-node" style={containerStyle}>
      <Handle type="target" position={Position.Top} style={{ background: '#30363d', width: '8px', height: '8px', border: 'none' }} />
      <div className="node-header">
        <div className="message" title={data.label}>{data.label}</div>
        <div className="hash">{data.hash.substring(0, 7)}</div>
      </div>
      {refList.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {refList.map((ref, i) => (
            <span key={i} style={{ 
              fontSize: '10px', padding: '2px 6px', borderRadius: '12px', border: '1px solid var(--border-default)', 
              color: 'var(--text-secondary)',
              backgroundColor: ref.includes('HEAD') ? 'var(--border-glow)' : 'transparent',
              borderColor: ref.includes('HEAD') ? 'var(--link-color)' : 'var(--border-default)'
            }}>
              {ref}
            </span>
          ))}
        </div>
      )}
      <div className="author-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <img 
            src={`https://github.com/${data.author}.png?size=40`} alt={data.author} 
            style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid var(--border-default)' }}
            onError={(e) => { e.target.style.display = 'none'; }}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="author-name">{data.author}</span>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{data.date.split('T')[0]}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#30363d', width: '8px', height: '8px', border: 'none' }} />
    </div>
  );
};

const nodeTypes = { commit: CommitNode };

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  const nodeWidth = 280; const nodeHeight = 100;
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });
  nodes.forEach((node) => { dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight }); });
  edges.forEach((edge) => { dagreGraph.setEdge(edge.source, edge.target); });
  dagre.layout(dagreGraph);
  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: Position.Top, sourcePosition: Position.Bottom,
      position: { x: nodeWithPosition.x - nodeWidth / 2, y: nodeWithPosition.y - nodeHeight / 2 },
    };
  });
  return { nodes: newNodes, edges };
};

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [contributors, setContributors] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  
  const [sessionId, setSessionId] = useState(null);
  const [currentRepoName, setCurrentRepoName] = useState(null);
  const [repoInfo, setRepoInfo] = useState(null);
  const [defaultBranch, setDefaultBranch] = useState('main');
  
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitDiff, setCommitDiff] = useState(null);

  const [token, setToken] = useState(localStorage.getItem('github_token') || '');
  const [userProfile, setUserProfile] = useState(null);

  const [activeTab, setActiveTab] = useState('overview'); 
  const [searchQuery, setSearchQuery] = useState('');

  // Time-Travel Auto-Play State
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleNodeIndex, setVisibleNodeIndex] = useState(-1);

  // File Explorer State
  const [fileTree, setFileTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  
  // PRs State
  const [pullRequests, setPullRequests] = useState([]);

  // Recent Repos State
  const [recentRepos, setRecentRepos] = useState([]);

  useEffect(() => { document.body.className = theme === 'light' ? 'theme-light' : 'theme-dark'; }, [theme]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      localStorage.setItem('github_token', tokenFromUrl);
      window.history.replaceState({}, document.title, '/');
    }
    if (!sessionId) setSessionId(crypto.randomUUID());
  }, [sessionId]);

  const getHeaders = useCallback(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  useEffect(() => {
      const fetchProfile = async () => {
          if (!token) { setUserProfile(null); setRecentRepos([]); return; }
          try {
              const res = await axios.get(`${API_BASE}/auth/user`, { headers: getHeaders() });
              setUserProfile(res.data);
              const saved = localStorage.getItem(`recent_repos_${res.data.login}`);
              if (saved) setRecentRepos(JSON.parse(saved));
          } catch (e) {
              console.error("Token invalid"); setToken(''); localStorage.removeItem('github_token'); setRecentRepos([]);
          }
      };
      fetchProfile();
  }, [token, getHeaders]);

  // Handle Search and Auto-Play visibility
  useEffect(() => {
      setNodes((nds) => nds.map((n) => {
          const query = searchQuery.trim().toLowerCase();
          const match = query ? (n.data.label.toLowerCase().includes(query) || n.data.author.toLowerCase().includes(query) || n.data.hash.toLowerCase().includes(query)) : false;
          const isHidden = visibleNodeIndex >= 0 && n.data.chronologicalIndex > visibleNodeIndex;
          return { ...n, data: { ...n.data, isDimmed: query && !match, isHighlighted: match, isHidden } };
      }));
      setEdges((eds) => eds.map((e) => {
          const sourceNode = nodes.find(n => n.id === e.source);
          const targetNode = nodes.find(n => n.id === e.target);
          const isHidden = visibleNodeIndex >= 0 && (sourceNode?.data.chronologicalIndex > visibleNodeIndex || targetNode?.data.chronologicalIndex > visibleNodeIndex);
          return { ...e, hidden: isHidden };
      }));
  }, [searchQuery, visibleNodeIndex]);

  // Auto-Play Timer
  useEffect(() => {
      if (isPlaying && nodes.length > 0) {
          const interval = setInterval(() => {
              setVisibleNodeIndex(prev => {
                  if (prev >= nodes.length - 1) { setIsPlaying(false); return -1; }
                  return prev + 1;
              });
          }, 300);
          return () => clearInterval(interval);
      }
  }, [isPlaying, nodes.length]);

  const handlePlayToggle = () => {
      if (isPlaying) { setIsPlaying(false); setVisibleNodeIndex(-1); } 
      else { setIsPlaying(true); setVisibleNodeIndex(0); }
  };

  const handleLogin = () => { window.location.href = `${API_BASE}/auth/github`; };
  const handleLogout = () => { setToken(''); localStorage.removeItem('github_token'); setUserProfile(null); };

  const handleClone = async () => {
    if (!repoUrl || !sessionId) return;
    setLoading(true); setRepoInfo(null); setNodes([]); setSearchQuery(''); setFileTree([]); setPullRequests([]);
    try {
      const res = await axios.post(`${API_BASE}/repo/clone`, { url: repoUrl, sessionId }, { headers: getHeaders() });
      const repoName = res.data.name;
      setCurrentRepoName(repoName);
      
      const [graphRes, contribRes, infoRes] = await Promise.all([
        axios.get(`${API_BASE}/repo/graph`, { params: { repoName }, headers: getHeaders() }),
        axios.get(`${API_BASE}/repo/contributors`, { params: { repoName }, headers: getHeaders() }),
        axios.get(`${API_BASE}/repo/info`, { params: { repoName }, headers: getHeaders() }).catch(() => ({data: null}))
      ]);
      
      if (infoRes.data) {
          setRepoInfo(infoRes.data);
          setDefaultBranch(infoRes.data.default_branch || 'main');
      }
      
      const formattedNodes = graphRes.data.nodes.map(n => ({ ...n, type: 'commit' }));
      // Assign chronological index for Auto-Play
      const sortedByDate = [...formattedNodes].sort((a, b) => new Date(a.data.date) - new Date(b.data.date));
      const hashToIndex = {};
      sortedByDate.forEach((n, i) => { hashToIndex[n.id] = i; });
      formattedNodes.forEach(n => { n.data.chronologicalIndex = hashToIndex[n.id]; });

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(formattedNodes, graphRes.data.edges);
      
      const styledEdges = layoutedEdges.map(e => ({ ...e, style: { stroke: 'var(--link-color)', strokeWidth: 2, opacity: 0.6 }, animated: true }));
      
      setNodes(layoutedNodes); setEdges(styledEdges);
      setContributors(contribRes.data); setAnalytics(graphRes.data.analytics || []);
      
      // Save to recent repos
      if (userProfile) {
          const newRecent = [{ name: repoName, url: repoUrl }, ...recentRepos.filter(r => r.name !== repoName)].slice(0, 5);
          setRecentRepos(newRecent);
          localStorage.setItem(`recent_repos_${userProfile.login}`, JSON.stringify(newRecent));
      }
      
      setActiveTab('graph');
      
    } catch (err) {
      console.error(err);
      if (err.response?.status === 404) alert('Repository not found. If it is private, please login with GitHub first.');
      else alert('Failed to process repository.');
    } finally {
      setLoading(false);
    }
  };

  const fetchExtraData = async (tab) => {
      if (!currentRepoName) return;
      try {
          if (tab === 'explorer' && fileTree.length === 0) {
              const res = await axios.get(`${API_BASE}/repo/tree`, { params: { repoName: currentRepoName, branch: defaultBranch }, headers: getHeaders() });
              // Only show files (blobs), ignore directories since we get a flat recursive list
              setFileTree(res.data.filter(f => f.type === 'blob'));
          } else if (tab === 'prs' && pullRequests.length === 0) {
              const res = await axios.get(`${API_BASE}/repo/prs`, { params: { repoName: currentRepoName }, headers: getHeaders() });
              setPullRequests(res.data);
          }
      } catch (e) { console.error("Failed fetching extra data", e); }
  };

  const handleTabSwitch = (tab) => { setActiveTab(tab); fetchExtraData(tab); };

  const handleFileClick = async (path) => {
      setSelectedFile(path); setFileContent('Loading...');
      try {
          const res = await axios.get(`${API_BASE}/repo/file`, { params: { repoName: currentRepoName, path }, headers: getHeaders() });
          if (res.data.content) {
              // Clean up base64 string (GitHub includes newlines) and decode UTF-8 safely
              const cleanBase64 = res.data.content.replace(/\s/g, '');
              const decoded = decodeURIComponent(escape(atob(cleanBase64)));
              setFileContent(decoded);
          } else {
              setFileContent('File has no content or is too large.');
          }
      } catch (e) { 
          console.error(e);
          setFileContent(`Failed to load file content. (Ensure backend has finished deploying!)`); 
      }
  };

  const onNodeClick = async (_, node) => {
    try {
      setSelectedCommit(node.data); setCommitDiff(null);
      const res = await axios.get(`${API_BASE}/repo/diff/${node.data.hash}`, { params: { repoName: currentRepoName }, headers: getHeaders() });
      setCommitDiff(res.data);
    } catch (err) { console.error(err); }
  };

  const handleDownloadImage = useCallback(() => {
    const el = document.querySelector('.react-flow');
    if (!el) return;
    toPng(el, { backgroundColor: theme === 'dark' ? '#0d1117' : '#ffffff' }).then((dataUrl) => {
      const a = document.createElement('a');
      a.setAttribute('download', `${currentRepoName ? currentRepoName.replace('/', '-') : 'repo'}-graph.png`);
      a.setAttribute('href', dataUrl); a.click();
    });
  }, [currentRepoName, theme]);

  const getHeatmapValues = useMemo(() => {
      if (!analytics.length) return [];
      return analytics.map(a => ({ date: new Date(a.date), count: a.commits }));
  }, [analytics]);

  const renderTabContent = () => {
      if (activeTab === 'overview') {
          return (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ padding: '40px', maxWidth: '900px', margin: '0 auto', width: '100%' }}>
                  {repoInfo ? (
                      <div className="overview-card">
                          <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>{repoInfo.full_name}</h1>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '16px', marginBottom: '24px' }}>{repoInfo.description || 'No description provided.'}</p>
                          <div className="stats-grid">
                              <div className="stat-box"><div className="stat-value">{repoInfo.stargazers_count}</div><div className="stat-label"><Star size={14}/> Stars</div></div>
                              <div className="stat-box"><div className="stat-value">{repoInfo.forks_count}</div><div className="stat-label"><GitFork size={14}/> Forks</div></div>
                              <div className="stat-box"><div className="stat-value">{repoInfo.open_issues_count}</div><div className="stat-label">Open Issues</div></div>
                              <div className="stat-box"><div className="stat-value">{repoInfo.language || 'Mixed'}</div><div className="stat-label">Language</div></div>
                          </div>
                      </div>
                  ) : (
                      <div style={{ textAlign: 'center', marginTop: '100px', color: 'var(--text-secondary)' }}>
                          <BookOpen size={64} style={{ marginBottom: '20px', opacity: 0.5 }} />
                          <h2>Welcome to Git Visualiser</h2><p>Enter a repository URL in the sidebar to get started.</p>
                      </div>
                  )}
              </motion.div>
          );
      }
      
      if (activeTab === 'graph') {
          return (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ height: '100%', width: '100%', position: 'relative' }}>
                  {nodes.length > 0 && (
                      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <div style={{ position: 'relative' }}>
                              <Search size={16} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--text-secondary)' }} />
                              <input type="text" placeholder="Search commits..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                  style={{ paddingLeft: '32px', width: '250px', background: 'var(--bg-secondary)', backdropFilter: 'blur(10px)' }} />
                          </div>
                          <button className="btn-secondary" onClick={handlePlayToggle} style={{ background: 'var(--bg-secondary)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', gap: '6px', height: '40px' }} title="Time-Travel Auto-Play">
                              {isPlaying ? <Pause size={16} /> : <Play size={16} />} {isPlaying ? 'Stop' : 'Play Timeline'}
                          </button>
                          <button className="btn-secondary" onClick={handleDownloadImage} style={{ background: 'var(--bg-secondary)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', gap: '6px', height: '40px' }}>
                              <Download size={16} /> Export
                          </button>
                      </div>
                  )}
                  {nodes.length > 0 ? (
                      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={onNodeClick} nodeTypes={nodeTypes} fitView>
                          <Controls style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-default)', fill: 'var(--text-primary)' }} />
                          <Background color="var(--border-default)" gap={20} size={1} />
                      </ReactFlow>
                  ) : (
                      <div style={{display:'flex', height:'100%', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)'}}>
                          <div style={{textAlign: 'center'}}><GitPullRequest size={48} style={{marginBottom: '16px', opacity: 0.5}} /><p>No graph data loaded.</p></div>
                      </div>
                  )}
              </motion.div>
          );
      }

      if (activeTab === 'explorer') {
          return (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ padding: '24px', display: 'flex', gap: '24px', height: '100%', overflow: 'hidden' }}>
                  <div className="file-tree" style={{ width: '300px', overflowY: 'auto' }}>
                      {fileTree.length > 0 ? fileTree.map((f, i) => (
                          <div key={i} className="file-item" onClick={() => f.type === 'blob' && handleFileClick(f.path)}>
                              {f.type === 'tree' ? <Folder size={16} color="var(--link-color)" /> : <File size={16} color="var(--text-secondary)" />}
                              <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{f.path}</span>
                          </div>
                      )) : <p style={{padding: '20px', color: 'var(--text-secondary)'}}>Loading file tree...</p>}
                  </div>
                  <div style={{ flex: 1, border: '1px solid var(--border-default)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                          <Code size={16} /> {selectedFile || 'Select a file to view'}
                      </div>
                      <div style={{ flex: 1, overflow: 'auto' }}>
                          {selectedFile && (
                              <SyntaxHighlighter language={selectedFile.split('.').pop()} style={theme === 'dark' ? vscDarkPlus : vs} customStyle={{ margin: 0, minHeight: '100%', background: 'transparent' }}>
                                  {fileContent}
                              </SyntaxHighlighter>
                          )}
                      </div>
                  </div>
              </motion.div>
          );
      }

      if (activeTab === 'prs') {
          return (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
                  <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><GitPullRequest size={24} color="var(--link-color)"/> Pull Requests</h2>
                  <div className="prs-grid">
                      {pullRequests.length > 0 ? pullRequests.map((pr, i) => (
                          <a key={i} href={pr.html_url} target="_blank" rel="noreferrer" className="pr-card">
                              {pr.state === 'open' ? <CheckCircle size={20} color="var(--text-success)" /> : (pr.merged_at ? <GitMerge size={20} color="#8957e5" /> : <XCircle size={20} color="#f85149" />)}
                              <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>{pr.title}</div>
                                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>#{pr.number} opened by {pr.user.login}</div>
                              </div>
                          </a>
                      )) : <p style={{color: 'var(--text-secondary)'}}>No pull requests found.</p>}
                  </div>
              </motion.div>
          );
      }
      
      if (activeTab === 'analytics') {
          return (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', width: '100%', overflowY: 'auto' }}>
                  {analytics.length > 0 ? (
                      <>
                          <h2 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}><Activity size={24} color="var(--accent-color)" /> Contribution Heatmap</h2>
                          <div className="overview-card heatmap-container" style={{ padding: '40px' }}>
                              <CalendarHeatmap
                                  startDate={new Date(new Date().setFullYear(new Date().getFullYear() - 1))}
                                  endDate={new Date()}
                                  values={getHeatmapValues}
                                  classForValue={(value) => {
                                      if (!value || value.count === 0) return 'color-empty';
                                      if (value.count < 3) return 'color-scale-1';
                                      if (value.count < 8) return 'color-scale-2';
                                      if (value.count < 15) return 'color-scale-3';
                                      return 'color-scale-4';
                                  }}
                                  tooltipDataAttrs={value => ({ 'data-tip': `${value.count || 0} commits on ${value.date}` })}
                              />
                          </div>

                          <h2 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}><Activity size={24} color="var(--accent-color)" /> Commit Activity</h2>
                          <div className="chart-container">
                              <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={analytics}>
                                      <defs><linearGradient id="colorCommits" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.8}/><stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0}/></linearGradient></defs>
                                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
                                      <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={12} tickLine={false} />
                                      <Tooltip contentStyle={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-default)', color: 'var(--text-primary)', borderRadius: '8px' }} />
                                      <Area type="monotone" dataKey="commits" stroke="var(--accent-color)" fillOpacity={1} fill="url(#colorCommits)" />
                                  </AreaChart>
                              </ResponsiveContainer>
                          </div>
                          
                          <h2 style={{ marginBottom: '20px', marginTop: '40px', display: 'flex', alignItems: 'center', gap: '8px' }}><PieChart size={24} color="var(--link-color)" /> Top Contributors</h2>
                          <div className="contributors-grid">
                              {contributors.sort((a,b) => b.commits - a.commits).map((c, i) => (
                                  <a key={i} href={c.profileUrl} target="_blank" rel="noreferrer" className="contributor-card">
                                      <img src={c.avatarUrl || `https://github.com/${c.name}.png`} alt={c.name} />
                                      <div style={{ flex: 1 }}>
                                          <div style={{ fontWeight: 600, color: 'var(--link-color)' }}>{c.name}</div>
                                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{c.commits} commits</div>
                                      </div>
                                  </a>
                              ))}
                          </div>
                      </>
                  ) : <div style={{ textAlign: 'center', marginTop: '100px', color: 'var(--text-secondary)' }}><p>Load a repository to see analytics.</p></div>}
              </motion.div>
          );
      }
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="branding">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitGraph size={24} color="var(--link-color)" /><span>Git Visualiser</span>
          </div>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="btn-secondary" style={{ padding: '6px' }} title="Toggle Theme">
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        
        <div className="sidebar-content">
            {userProfile ? (
                <div className="user-profile">
                    <img src={userProfile.avatar_url} alt="avatar" className="user-avatar" />
                    <div className="user-info">
                        <a href={userProfile.html_url} target="_blank" rel="noreferrer" className="name" style={{textDecoration:'none'}}>{userProfile.name}</a>
                        <span className="status"><User size={12}/> Connected</span>
                    </div>
                    <button onClick={handleLogout} className="btn-secondary" style={{ marginLeft: 'auto', padding: '6px' }} title="Logout"><LogOut size={14} /></button>
                </div>
            ) : (
                <div style={{ marginBottom: '24px', padding: '16px', background: 'var(--bg-glass)', borderRadius: '12px', border: '1px solid var(--border-default)' }}>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Connect GitHub to visualize private repos & get higher rate limits.</p>
                    <button onClick={handleLogin} className="btn-primary" style={{ width: '100%' }}><LogIn size={16} /> Login with GitHub</button>
                </div>
            )}
            
            <div className="input-section">
                <div className="input-group">
                    <label>Repository URL</label>
                    <input type="text" placeholder="https://github.com/user/repo" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} />
                </div>
                <button className="btn-primary" onClick={handleClone} disabled={loading}>
                    <Download size={16} />{loading ? 'Fetching...' : 'Load Repository'}
                </button>
            </div>

            {recentRepos.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', display: 'block' }}>Recent Repositories</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {recentRepos.map((r, i) => (
                            <button 
                                key={i} 
                                className="btn-secondary" 
                                style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                onClick={() => { setRepoUrl(r.url); setTimeout(() => document.querySelector('.input-section .btn-primary').click(), 100); }}
                            >
                                {r.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
      </div>

      <div className="main-content">
        <div className="tabs-header">
            <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => handleTabSwitch('overview')}><Info size={16} /> Overview{activeTab === 'overview' && <motion.div layoutId="indicator" className="tab-indicator" />}</button>
            <button className={`tab-btn ${activeTab === 'graph' ? 'active' : ''}`} onClick={() => handleTabSwitch('graph')}><GitGraph size={16} /> Network Graph{activeTab === 'graph' && <motion.div layoutId="indicator" className="tab-indicator" />}</button>
            <button className={`tab-btn ${activeTab === 'explorer' ? 'active' : ''}`} onClick={() => handleTabSwitch('explorer')}><Folder size={16} /> Code Explorer{activeTab === 'explorer' && <motion.div layoutId="indicator" className="tab-indicator" />}</button>
            <button className={`tab-btn ${activeTab === 'prs' ? 'active' : ''}`} onClick={() => handleTabSwitch('prs')}><GitPullRequest size={16} /> Pull Requests{activeTab === 'prs' && <motion.div layoutId="indicator" className="tab-indicator" />}</button>
            <button className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => handleTabSwitch('analytics')}><Activity size={16} /> Analytics{activeTab === 'analytics' && <motion.div layoutId="indicator" className="tab-indicator" />}</button>
        </div>

        <div className="tab-content">
            <AnimatePresence mode="wait">{renderTabContent()}</AnimatePresence>
        </div>

        <div className={`side-panel ${selectedCommit ? 'open' : ''}`}>
          <div className="panel-header"><h2 style={{ fontSize: '16px' }}>Commit Details</h2><button className="close-btn" onClick={() => setSelectedCommit(null)}><X size={20} /></button></div>
          <div className="panel-content">
            {selectedCommit && (
              <>
                <div className="commit-meta-box">
                  <h3 style={{marginBottom: '12px', color: 'var(--text-primary)', fontSize: '16px', lineHeight: 1.4}}>{selectedCommit.label}</h3>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px'}}>
                    <img src={`https://github.com/${selectedCommit.author}.png?size=32`} style={{width:'24px', borderRadius:'50%'}} onError={(e)=>{e.target.style.display='none'}} />
                    <span style={{fontWeight: 600, fontSize: '13px'}}>{selectedCommit.author}</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px'}}><span>committed on {new Date(selectedCommit.date).toLocaleString()}</span></div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--link-color)'}}><GitCommitIcon size={14} /><span>{selectedCommit.hash}</span></div>
                </div>
                {commitDiff ? (
                  <><h4 style={{fontSize: '13px', marginBottom: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase'}}>Changed files</h4><div className="diff-stat" style={{fontSize: '12px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', marginBottom: '16px'}}>{commitDiff.summary}</div><div className="diff-container"><div className="diff-header">Code Changes</div><div className="diff-content">{commitDiff.diff}</div></div></>
                ) : <div style={{color: 'var(--text-secondary)', display: 'flex', justifyContent: 'center', padding: '40px'}}><motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}><Activity size={24} /></motion.div></div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
