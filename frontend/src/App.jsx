import React, { useState, useEffect, useCallback } from 'react';
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
    PieChart, Info, BookOpen, Star, GitFork, User, Search
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { toPng } from 'html-to-image';

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const API_BASE = RAW_API_BASE.replace(/\/repo\/?$/, '');

// Custom Node Component (GitHub Style)
const CommitNode = ({ data }) => {
  const refsRaw = data.refs ? data.refs.trim() : '';
  const refList = refsRaw.startsWith('(') && refsRaw.endsWith(')') 
    ? refsRaw.slice(1, -1).split(',').map(r => r.trim()).filter(Boolean)
    : [];

  // Color-coded branches
  let borderColor = 'var(--border-default)';
  let glowColor = 'transparent';
  if (refsRaw.includes('HEAD')) {
      borderColor = '#58a6ff'; // Blue for main/HEAD
      glowColor = 'rgba(88, 166, 255, 0.3)';
  } else if (refsRaw.includes('feat') || refsRaw.includes('feature')) {
      borderColor = '#d2a8ff'; // Purple for features
      glowColor = 'rgba(210, 168, 255, 0.3)';
  } else if (refsRaw.includes('fix') || refsRaw.includes('bug')) {
      borderColor = '#f85149'; // Red for fixes
      glowColor = 'rgba(248, 81, 73, 0.3)';
  } else if (refsRaw.includes('origin/')) {
      borderColor = '#3fb950'; // Green for other remote branches
      glowColor = 'rgba(63, 185, 80, 0.3)';
  }

  const containerStyle = {
      opacity: data.isDimmed ? 0.3 : 1,
      transform: data.isHighlighted ? 'scale(1.05)' : 'scale(1)',
      borderColor: data.isHighlighted ? '#fff' : borderColor,
      boxShadow: data.isHighlighted ? `0 0 20px rgba(255,255,255,0.5)` : `0 4px 12px rgba(0,0,0,0.2), 0 0 10px ${glowColor}`,
      zIndex: data.isHighlighted ? 10 : 1,
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
              fontSize: '10px', 
              padding: '2px 6px', 
              borderRadius: '12px', 
              border: '1px solid var(--border-default)', 
              color: 'var(--text-secondary)',
              backgroundColor: ref.includes('HEAD') ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
              borderColor: ref.includes('HEAD') ? 'var(--link-color)' : 'var(--border-default)'
            }}>
              {ref}
            </span>
          ))}
        </div>
      )}
      <div className="author-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <img 
            src={`https://github.com/${data.author}.png?size=40`} 
            alt={data.author} 
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

const nodeTypes = {
  commit: CommitNode,
};

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const nodeWidth = 280;
  const nodeHeight = 100; // Increased to fit avatars
  
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: newNodes, edges };
};

export default function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [contributors, setContributors] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  
  const [sessionId, setSessionId] = useState(null);
  const [currentRepoName, setCurrentRepoName] = useState(null);
  const [repoInfo, setRepoInfo] = useState(null);
  
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitDiff, setCommitDiff] = useState(null);

  const [token, setToken] = useState(localStorage.getItem('github_token') || '');
  const [userProfile, setUserProfile] = useState(null);

  const [activeTab, setActiveTab] = useState('overview'); // overview, graph, analytics
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      localStorage.setItem('github_token', tokenFromUrl);
      window.history.replaceState({}, document.title, '/');
    }
    
    if (!sessionId) {
      setSessionId(crypto.randomUUID());
    }
  }, [sessionId]);

  const getHeaders = useCallback(() => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [token]);

  // Fetch user profile if token exists
  useEffect(() => {
      const fetchProfile = async () => {
          if (!token) {
              setUserProfile(null);
              return;
          }
          try {
              const res = await axios.get(`${API_BASE}/auth/user`, { headers: getHeaders() });
              setUserProfile(res.data);
          } catch (e) {
              console.error("Token might be invalid or expired");
              setToken('');
              localStorage.removeItem('github_token');
          }
      };
      fetchProfile();
  }, [token, getHeaders]);

  // Handle Search Graph Highlighting
  useEffect(() => {
      setNodes((nds) => nds.map((n) => {
          const query = searchQuery.trim().toLowerCase();
          if (!query) {
              return { ...n, data: { ...n.data, isDimmed: false, isHighlighted: false } };
          }
          const match = n.data.label.toLowerCase().includes(query) || n.data.author.toLowerCase().includes(query) || n.data.hash.toLowerCase().includes(query);
          return { ...n, data: { ...n.data, isDimmed: !match, isHighlighted: match } };
      }));
  }, [searchQuery, setNodes]);

  const handleLogin = () => {
    window.location.href = `${API_BASE}/auth/github`;
  };

  const handleLogout = () => {
    setToken('');
    localStorage.removeItem('github_token');
    setUserProfile(null);
  };

  const handleClone = async () => {
    if (!repoUrl || !sessionId) return;
    setLoading(true);
    setRepoInfo(null);
    setNodes([]);
    setSearchQuery('');
    try {
      const res = await axios.post(`${API_BASE}/repo/clone`, 
        { url: repoUrl, sessionId }, 
        { headers: getHeaders() }
      );
      const repoName = res.data.name;
      setCurrentRepoName(repoName);
      
      const [graphRes, contribRes, infoRes] = await Promise.all([
        axios.get(`${API_BASE}/repo/graph`, { params: { repoName }, headers: getHeaders() }),
        axios.get(`${API_BASE}/repo/contributors`, { params: { repoName }, headers: getHeaders() }),
        axios.get(`${API_BASE}/repo/info`, { params: { repoName }, headers: getHeaders() }).catch(() => ({data: null}))
      ]);
      
      if (infoRes.data) setRepoInfo(infoRes.data);
      
      const formattedNodes = graphRes.data.nodes.map(n => ({
        ...n,
        type: 'commit',
      }));
      
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        formattedNodes,
        graphRes.data.edges
      );
      
      const styledEdges = layoutedEdges.map(e => ({
        ...e,
        style: { stroke: '#58a6ff', strokeWidth: 2, opacity: 0.6 },
        animated: true
      }));
      
      setNodes(layoutedNodes);
      setEdges(styledEdges);
      setContributors(contribRes.data);
      setAnalytics(graphRes.data.analytics || []);
      
      setActiveTab('graph'); // Switch to graph once loaded
      
    } catch (err) {
      console.error(err);
      if (err.response && err.response.status === 404) {
          alert('Repository not found. If it is a private repository, please login with GitHub first.');
      } else {
          alert('Failed to process repository.');
      }
    } finally {
      setLoading(false);
    }
  };

  const onNodeClick = async (_, node) => {
    try {
      setSelectedCommit(node.data);
      setCommitDiff(null);
      const res = await axios.get(`${API_BASE}/repo/diff/${node.data.hash}`, { 
        params: { repoName: currentRepoName },
        headers: getHeaders()
      });
      setCommitDiff(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownloadImage = useCallback(() => {
    const el = document.querySelector('.react-flow');
    if (!el) return;
    toPng(el, { backgroundColor: '#0d1117' }).then((dataUrl) => {
      const a = document.createElement('a');
      a.setAttribute('download', `${currentRepoName ? currentRepoName.replace('/', '-') : 'repo'}-graph.png`);
      a.setAttribute('href', dataUrl);
      a.click();
    }).catch(err => {
      console.error('Failed to export graph', err);
      alert('Failed to export graph image.');
    });
  }, [currentRepoName]);

  // Content rendering based on active tab
  const renderTabContent = () => {
      if (activeTab === 'overview') {
          return (
              <motion.div 
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  style={{ padding: '40px', maxWidth: '900px', margin: '0 auto', width: '100%' }}
              >
                  {repoInfo ? (
                      <div className="overview-card">
                          <h1 style={{ fontSize: '32px', marginBottom: '8px', color: '#fff' }}>{repoInfo.full_name}</h1>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '16px', marginBottom: '24px' }}>
                              {repoInfo.description || 'No description provided.'}
                          </p>
                          <div className="stats-grid">
                              <div className="stat-box">
                                  <div className="stat-value">{repoInfo.stargazers_count}</div>
                                  <div className="stat-label"><Star size={14} style={{display:'inline', marginRight:'4px'}}/> Stars</div>
                              </div>
                              <div className="stat-box">
                                  <div className="stat-value">{repoInfo.forks_count}</div>
                                  <div className="stat-label"><GitFork size={14} style={{display:'inline', marginRight:'4px'}}/> Forks</div>
                              </div>
                              <div className="stat-box">
                                  <div className="stat-value">{repoInfo.open_issues_count}</div>
                                  <div className="stat-label">Open Issues</div>
                              </div>
                              <div className="stat-box">
                                  <div className="stat-value">{repoInfo.language || 'Mixed'}</div>
                                  <div className="stat-label">Language</div>
                              </div>
                          </div>
                      </div>
                  ) : (
                      <div style={{ textAlign: 'center', marginTop: '100px', color: 'var(--text-secondary)' }}>
                          <BookOpen size={64} style={{ marginBottom: '20px', opacity: 0.5 }} />
                          <h2>Welcome to Git Visualiser</h2>
                          <p>Enter a repository URL in the sidebar to get started.</p>
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
                              <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-secondary)' }} />
                              <input 
                                  type="text" 
                                  placeholder="Search commits or authors..." 
                                  value={searchQuery}
                                  onChange={e => setSearchQuery(e.target.value)}
                                  style={{ paddingLeft: '32px', width: '280px', background: 'rgba(22, 27, 34, 0.8)', backdropFilter: 'blur(10px)', border: '1px solid var(--border-default)' }}
                              />
                          </div>
                          <button className="btn-secondary" onClick={handleDownloadImage} style={{ background: 'rgba(22, 27, 34, 0.8)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', gap: '6px', height: '40px' }} title="Export Graph as PNG">
                              <Download size={16} /> Export Image
                          </button>
                      </div>
                  )}

                  {nodes.length > 0 ? (
                      <ReactFlow
                          nodes={nodes}
                          edges={edges}
                          onNodesChange={onNodesChange}
                          onEdgesChange={onEdgesChange}
                          onNodeClick={onNodeClick}
                          nodeTypes={nodeTypes}
                          fitView
                      >
                          <Controls style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-default)', fill: 'var(--text-primary)' }} />
                          <Background color="var(--border-default)" gap={20} size={1} />
                      </ReactFlow>
                  ) : (
                      <div style={{display:'flex', height:'100%', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)'}}>
                          <div style={{textAlign: 'center'}}>
                              <GitPullRequest size={48} style={{marginBottom: '16px', opacity: 0.5}} />
                              <p>No graph data loaded.</p>
                          </div>
                      </div>
                  )}
              </motion.div>
          );
      }
      
      if (activeTab === 'analytics') {
          return (
              <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', width: '100%', overflowY: 'auto' }}
              >
                  {analytics.length > 0 ? (
                      <>
                          <h2 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Activity size={24} color="var(--accent-color)" /> Commit Activity
                          </h2>
                          <div className="chart-container">
                              <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={analytics}>
                                      <defs>
                                          <linearGradient id="colorCommits" x1="0" y1="0" x2="0" y2="1">
                                              <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.8}/>
                                              <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0}/>
                                          </linearGradient>
                                      </defs>
                                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
                                      <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={12} tickLine={false} />
                                      <Tooltip 
                                          contentStyle={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-default)', color: 'var(--text-primary)', borderRadius: '8px' }}
                                      />
                                      <Area type="monotone" dataKey="commits" stroke="var(--accent-color)" fillOpacity={1} fill="url(#colorCommits)" />
                                  </AreaChart>
                              </ResponsiveContainer>
                          </div>
                          
                          <h2 style={{ marginBottom: '20px', marginTop: '40px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <PieChart size={24} color="var(--link-color)" /> Top Contributors
                          </h2>
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
                  ) : (
                      <div style={{ textAlign: 'center', marginTop: '100px', color: 'var(--text-secondary)' }}>
                          <p>Load a repository to see analytics.</p>
                      </div>
                  )}
              </motion.div>
          );
      }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="branding">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitGraph size={24} color="var(--link-color)" />
            <span>Git Visualiser</span>
          </div>
        </div>
        
        <div className="sidebar-content">
            {/* User Profile Area */}
            {userProfile ? (
                <div className="user-profile">
                    <img src={userProfile.avatar_url} alt="avatar" className="user-avatar" />
                    <div className="user-info">
                        <a href={userProfile.html_url} target="_blank" rel="noreferrer" className="name" style={{textDecoration:'none'}}>{userProfile.name}</a>
                        <span className="status"><User size={12}/> Connected</span>
                    </div>
                    <button onClick={handleLogout} className="btn-secondary" style={{ marginLeft: 'auto', padding: '6px' }} title="Logout">
                        <LogOut size={14} />
                    </button>
                </div>
            ) : (
                <div style={{ marginBottom: '24px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-default)' }}>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Connect GitHub to visualize private repos & get higher rate limits.</p>
                    <button onClick={handleLogin} className="btn-primary" style={{ width: '100%' }}>
                        <LogIn size={16} /> Login with GitHub
                    </button>
                </div>
            )}
            
            <div className="input-section">
                <div className="input-group">
                    <label>Repository URL</label>
                    <input 
                        type="text" 
                        placeholder="https://github.com/user/repo"
                        value={repoUrl}
                        onChange={e => setRepoUrl(e.target.value)}
                    />
                </div>
                <button className="btn-primary" onClick={handleClone} disabled={loading}>
                    <Download size={16} />
                    {loading ? 'Fetching...' : 'Load Repository'}
                </button>
            </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        
        {/* Tabs Navigation */}
        <div className="tabs-header">
            <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
                <Info size={16} /> Overview
                {activeTab === 'overview' && <motion.div layoutId="indicator" className="tab-indicator" />}
            </button>
            <button className={`tab-btn ${activeTab === 'graph' ? 'active' : ''}`} onClick={() => setActiveTab('graph')}>
                <GitGraph size={16} /> Network Graph
                {activeTab === 'graph' && <motion.div layoutId="indicator" className="tab-indicator" />}
            </button>
            <button className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
                <Activity size={16} /> Analytics
                {activeTab === 'analytics' && <motion.div layoutId="indicator" className="tab-indicator" />}
            </button>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
            <AnimatePresence mode="wait">
                {renderTabContent()}
            </AnimatePresence>
        </div>

        {/* Side Panel for Diff Details (Only relevant for Graph tab) */}
        <div className={`side-panel ${selectedCommit ? 'open' : ''}`}>
          <div className="panel-header">
            <h2 style={{ fontSize: '16px' }}>Commit Details</h2>
            <button className="close-btn" onClick={() => setSelectedCommit(null)}>
              <X size={20} />
            </button>
          </div>
          
          <div className="panel-content">
            {selectedCommit && (
              <>
                <div className="commit-meta-box">
                  <h3 style={{marginBottom: '12px', color: 'var(--text-primary)', fontSize: '16px', lineHeight: 1.4}}>
                      {selectedCommit.label}
                  </h3>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px'}}>
                    <img src={`https://github.com/${selectedCommit.author}.png?size=32`} style={{width:'24px', borderRadius:'50%'}} onError={(e)=>{e.target.style.display='none'}} />
                    <span style={{fontWeight: 600, fontSize: '13px'}}>{selectedCommit.author}</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px'}}>
                      <span>committed on {new Date(selectedCommit.date).toLocaleString()}</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--link-color)'}}>
                    <GitCommitIcon size={14} />
                    <span>{selectedCommit.hash}</span>
                  </div>
                </div>
                
                {commitDiff ? (
                  <>
                    <h4 style={{fontSize: '13px', marginBottom: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase'}}>Changed files</h4>
                    <div className="diff-stat" style={{fontSize: '12px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', marginBottom: '16px'}}>{commitDiff.summary}</div>
                    
                    <div className="diff-container">
                      <div className="diff-header">Code Changes</div>
                      <div className="diff-content">{commitDiff.diff}</div>
                    </div>
                  </>
                ) : (
                  <div style={{color: 'var(--text-secondary)', display: 'flex', justifyContent: 'center', padding: '40px'}}>
                      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                          <Activity size={24} />
                      </motion.div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
