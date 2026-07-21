import React, { useState, useCallback } from 'react';
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
import { GitCommit, Download, X } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/repo';

// Custom Node Component
const CommitNode = ({ data }) => {
  return (
    <div className="commit-node">
      <Handle type="target" position={Position.Top} />
      <div className="hash">{data.hash.substring(0, 7)}</div>
      <div className="message">{data.label}</div>
      <div className="author">
        <span>{data.author}</span>
        <span>{data.date.split(' ')[0]}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

const nodeTypes = {
  commit: CommitNode,
};

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const nodeWidth = 260;
  const nodeHeight = 100;
  
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 100 });

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
  
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitDiff, setCommitDiff] = useState(null);

  const handleClone = async () => {
    if (!repoUrl) return;
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/clone`, { url: repoUrl });
      
      const [graphRes, contribRes] = await Promise.all([
        axios.get(`${API_BASE}/graph`),
        axios.get(`${API_BASE}/contributors`)
      ]);
      
      // format nodes for React flow
      const formattedNodes = graphRes.data.nodes.map(n => ({
        ...n,
        type: 'commit',
      }));
      
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        formattedNodes,
        graphRes.data.edges
      );
      
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
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
      const res = await axios.get(`${API_BASE}/diff/${node.data.hash}`);
      setCommitDiff(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar glass-panel">
        <div className="branding">
          <GitCommit size={32} color="#c084fc" />
          <h1>Git Vis</h1>
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
            <Download size={18} />
            {loading ? 'Processing...' : 'Load Repository'}
          </button>
        </div>
        
        {contributors.length > 0 && (
          <div className="stats-section">
            <h3>Top Contributors</h3>
            <div className="contributor-list">
              {contributors.sort((a,b) => b.commits - a.commits).slice(0, 10).map((c, i) => (
                <div key={i} className="contributor-item">
                  <span className="contributor-name">{c.name}</span>
                  <span className="contributor-commits">{c.commits}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="main-content glass-panel">
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
            <Controls />
            <MiniMap 
                nodeStrokeColor="#c084fc" 
                nodeColor="#1e293b" 
                maskColor="rgba(0,0,0,0.5)"
            />
            <Background color="#334155" gap={16} />
          </ReactFlow>
        ) : (
          <div style={{display:'flex', height:'100%', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)'}}>
            Load a repository to view the graph
          </div>
        )}

        {/* Side Panel */}
        <div className={`side-panel glass-panel ${selectedCommit ? 'open' : ''}`}>
          <div className="panel-header">
            <h2>Commit Details</h2>
            <button className="close-btn" onClick={() => setSelectedCommit(null)}>
              <X size={20} />
            </button>
          </div>
          
          <div className="panel-content">
            {selectedCommit && (
              <>
                <h3 style={{marginBottom: '8px', color: 'var(--accent)'}}>
                    {selectedCommit.hash}
                </h3>
                <p style={{marginBottom: '4px', fontWeight: 600}}>
                    {selectedCommit.label}
                </p>
                <p style={{marginBottom: '20px', fontSize: '0.85rem', color: 'var(--text-secondary)'}}>
                    By {selectedCommit.author} on {selectedCommit.date}
                </p>
                
                {commitDiff ? (
                  <>
                    <h4>Files Changed</h4>
                    <div className="diff-stat">{commitDiff.summary}</div>
                    
                    <h4>Diff</h4>
                    <div className="diff-content">{commitDiff.diff}</div>
                  </>
                ) : (
                  <div>Loading diff...</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
