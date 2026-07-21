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
import { Github, Download, X, GitCommit as GitCommitIcon, GitPullRequest } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/repo';

// Custom Node Component (GitHub Style)
const CommitNode = ({ data }) => {
  return (
    <div className="commit-node">
      <Handle type="target" position={Position.Top} style={{ background: '#30363d', width: '8px', height: '8px', border: 'none' }} />
      <div className="node-header">
        <div className="message" title={data.label}>{data.label}</div>
        <div className="hash">{data.hash.substring(0, 7)}</div>
      </div>
      <div className="author-info">
        <div className="avatar"></div>
        <span className="author-name">{data.author}</span>
        <span>committed on {data.date.split(' ')[0]}</span>
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
  
  const [sessionId, setSessionId] = useState(null);
  const [currentRepoName, setCurrentRepoName] = useState(null);
  
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitDiff, setCommitDiff] = useState(null);

  // Initialize a session ID when the app loads
  useEffect(() => {
    if (!sessionId) {
      setSessionId(crypto.randomUUID());
    }
    
    // Cleanup on unmount/refresh
    const handleUnload = () => {
      if (sessionId) {
        navigator.sendBeacon(`${API_BASE}/session?sessionId=${sessionId}`);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [sessionId]);

  const handleClone = async () => {
    if (!repoUrl || !sessionId) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/clone`, { url: repoUrl, sessionId });
      const repoName = res.data.name;
      setCurrentRepoName(repoName);
      
      const [graphRes, contribRes] = await Promise.all([
        axios.get(`${API_BASE}/graph`, { params: { sessionId, repoName } }),
        axios.get(`${API_BASE}/contributors`, { params: { sessionId, repoName } })
      ]);
      
      const formattedNodes = graphRes.data.nodes.map(n => ({
        ...n,
        type: 'commit',
      }));
      
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        formattedNodes,
        graphRes.data.edges
      );
      
      // Style the edges to match GitHub's network graph subtle lines
      const styledEdges = layoutedEdges.map(e => ({
        ...e,
        style: { stroke: '#30363d', strokeWidth: 2 },
        animated: false
      }));
      
      setNodes(layoutedNodes);
      setEdges(styledEdges);
      setContributors(contribRes.data);
      
    } catch (err) {
      console.error(err);
      alert('Failed to process repository.');
    } finally {
      setLoading(false);
    }
  };

  const onNodeClick = async (_, node) => {
    try {
      setSelectedCommit(node.data);
      setCommitDiff(null);
      const res = await axios.get(`${API_BASE}/diff/${node.data.hash}`, { 
        params: { sessionId, repoName: currentRepoName } 
      });
      setCommitDiff(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="app-container">
      {/* GitHub Style Sidebar */}
      <div className="sidebar">
        <div className="branding">
          <Github size={24} />
          Git Visualiser
        </div>
        
        <div className="input-section">
          <div className="input-group">
            <label>Repository URL</label>
            <input 
              type="text" 
              placeholder="https://github.com/user/repo.git"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={handleClone} disabled={loading}>
            <Download size={16} />
            {loading ? 'Cloning repository...' : 'Load Repository'}
          </button>
        </div>
        
        {contributors.length > 0 && (
          <div className="stats-section">
            <h3>Contributors</h3>
            <div className="contributor-list">
              {contributors.sort((a,b) => b.commits - a.commits).slice(0, 15).map((c, i) => (
                <div key={i} className="contributor-item">
                  <span className="contributor-name">
                    <div className="avatar"></div>
                    {c.name}
                  </span>
                  <span className="contributor-commits">{c.commits}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Graph Content */}
      <div className="main-content">
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
