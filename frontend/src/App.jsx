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
import { GitGraph, Download, X, GitCommit as GitCommitIcon, GitPullRequest, LogIn, LogOut, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
// Normalize API base just in case it was set to /api/repo previously
const API_BASE = RAW_API_BASE.replace(/\/repo\/?$/, '');

// Custom Node Component (GitHub Style)
const CommitNode = ({ data }) => {
  const refsRaw = data.refs ? data.refs.trim() : '';
  const refList = refsRaw.startsWith('(') && refsRaw.endsWith(')') 
    ? refsRaw.slice(1, -1).split(',').map(r => r.trim()).filter(Boolean)
    : [];

  return (
    <div className="commit-node">
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
      <div className="author-info">
        <span className="author-name">{data.author}</span>
        <span>committed on {data.date.split('T')[0]}</span>
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
  const nodeHeight = 80;
  
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
  
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitDiff, setCommitDiff] = useState(null);

  const [token, setToken] = useState(localStorage.getItem('github_token') || '');

  // Handle OAuth callback token
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

  const handleLogin = () => {
    window.location.href = `${API_BASE}/auth/github`;
  };

  const handleLogout = () => {
    setToken('');
    localStorage.removeItem('github_token');
  };

  const getHeaders = () => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const handleClone = async () => {
    if (!repoUrl || !sessionId) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/repo/clone`, 
        { url: repoUrl, sessionId }, 
        { headers: getHeaders() }
      );
      const repoName = res.data.name;
      setCurrentRepoName(repoName);
      
      const [graphRes, contribRes] = await Promise.all([
        axios.get(`${API_BASE}/repo/graph`, { params: { repoName }, headers: getHeaders() }),
        axios.get(`${API_BASE}/repo/contributors`, { params: { repoName }, headers: getHeaders() })
      ]);
      
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
        style: { stroke: '#30363d', strokeWidth: 2 },
        animated: false
      }));
      
      setNodes(layoutedNodes);
      setEdges(styledEdges);
      setContributors(contribRes.data);
      setAnalytics(graphRes.data.analytics || []);
      
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

  return (
    <div className="app-container">
      {/* GitHub Style Sidebar */}
      <div className="sidebar" style={{ width: '320px', overflowY: 'auto' }}>
        <div className="branding" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitGraph size={24} />
            <span>Git Visualiser</span>
          </div>
        </div>
        
        <div className="auth-section" style={{ marginBottom: '20px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
            {token ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-success)' }}>✓ GitHub Connected</span>
                    <button onClick={handleLogout} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }}>
                        <LogOut size={12} style={{marginRight: '4px'}} /> Logout
                    </button>
                </div>
            ) : (
                <div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Connect GitHub to visualize private repos & get higher rate limits.</p>
                    <button onClick={handleLogin} className="btn-primary" style={{ width: '100%', background: '#238636', display: 'flex', justifyContent: 'center' }}>
                        <LogIn size={14} style={{marginRight: '6px'}} /> Login with GitHub
                    </button>
                </div>
            )}
        </div>
        
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
          <button className="btn-primary" onClick={handleClone} disabled={loading} style={{ width: '100%' }}>
            <Download size={16} />
            {loading ? 'Fetching Repository...' : 'Load Repository'}
          </button>
        </div>
        
        {contributors.length > 0 && (
          <div className="stats-section">
            <h3>Contributors</h3>
            <div className="contributor-list">
              {contributors.sort((a,b) => b.commits - a.commits).map((c, i) => (
                <a key={i} href={c.profileUrl} target="_blank" rel="noreferrer" className="contributor-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="contributor-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt={c.name} style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                    ) : (
                        <div className="avatar"></div>
                    )}
                    <span style={{ color: 'var(--link-color)' }}>{c.name}</span>
                  </span>
                  <span className="contributor-commits">{c.commits}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Graph Content */}
      <div className="main-content" style={{ display: 'flex', flexDirection: 'column' }}>
        
        {analytics.length > 0 && (
            <div className="analytics-panel" style={{ height: '150px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-default)', padding: '16px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Activity size={16} color="var(--text-success)" />
                    Commit Activity (Fetched History)
                </h4>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analytics}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} />
                        <XAxis dataKey="date" stroke="#8b949e" fontSize={12} tickLine={false} />
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#c9d1d9' }}
                            itemStyle={{ color: '#58a6ff' }}
                        />
                        <Line type="monotone" dataKey="commits" stroke="#238636" strokeWidth={2} dot={{ r: 3, fill: '#2ea043', strokeWidth: 0 }} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        )}

        <div style={{ flex: 1, position: 'relative' }}>
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
                <Controls style={{ background: '#161b22', borderColor: '#30363d', fill: '#c9d1d9' }} />
                <MiniMap 
                    nodeStrokeColor="#30363d" 
                    nodeColor="#161b22" 
                    maskColor="rgba(13,17,23,0.8)"
                    style={{ backgroundColor: '#0d1117', border: '1px solid #30363d' }}
                />
                <Background color="#30363d" gap={20} size={1} />
            </ReactFlow>
            ) : (
            <div style={{display:'flex', height:'100%', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)'}}>
                <div style={{textAlign: 'center'}}>
                <GitPullRequest size={48} style={{marginBottom: '16px', opacity: 0.5}} />
                <p>Enter a Git repository URL to visualize its history.</p>
                </div>
            </div>
            )}
        </div>

        {/* Side Panel for Diff Details */}
        <div className={`side-panel ${selectedCommit ? 'open' : ''}`}>
          <div className="panel-header">
            <h2>Commit Details</h2>
            <button className="close-btn" onClick={() => setSelectedCommit(null)}>
              <X size={20} />
            </button>
          </div>
          
          <div className="panel-content">
            {selectedCommit && (
              <>
                <div className="commit-meta-box">
                  <h3 style={{marginBottom: '8px', color: 'var(--text-primary)', fontSize: '18px'}}>
                      {selectedCommit.label}
                  </h3>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px'}}>
                    <div className="avatar"></div>
                    <span style={{fontWeight: 600, fontSize: '14px'}}>{selectedCommit.author}</span>
                    <span style={{color: 'var(--text-secondary)', fontSize: '14px'}}>committed on {selectedCommit.date}</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)'}}>
                    <GitCommitIcon size={14} />
                    <span>{selectedCommit.hash}</span>
                  </div>
                </div>
                
                {commitDiff ? (
                  <>
                    <h4 style={{fontSize: '14px', marginBottom: '8px', color: 'var(--text-primary)'}}>Changed files</h4>
                    <div className="diff-stat">{commitDiff.summary}</div>
                    
                    <div className="diff-container">
                      <div className="diff-header">Code Changes</div>
                      <div className="diff-content">{commitDiff.diff}</div>
                    </div>
                  </>
                ) : (
                  <div style={{color: 'var(--text-secondary)'}}>Loading diff...</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
