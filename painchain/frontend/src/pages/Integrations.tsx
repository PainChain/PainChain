import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useIntegrations } from '../hooks/useIntegrations';
import { useIntegrationTypes } from '../hooks/useIntegrationTypes';
import { useTeams } from '../hooks/useTeams';
import type { Integration, Team } from '../types/api';

type ActiveTab = 'integrations' | 'teams';

interface ConfigField {
  key: string;
  label: string;
  type: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
}

interface ConnectorSchema {
  fields: ConfigField[];
}

export function Integrations() {
  const {
    integrations,
    loading,
    createIntegration,
    updateIntegration,
    deleteIntegration,
  } = useIntegrations();
  const { types, getSchema } = useIntegrationTypes();
  const { teams, loading: teamsLoading, createTeam, updateTeam, deleteTeam } = useTeams();

  const [activeTab, setActiveTab] = useState<ActiveTab>('integrations');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingIntegration, setEditingIntegration] = useState<Integration | null>(null);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createForm, setCreateForm] = useState({
    type: '',
    name: '',
    config: '{}',
  });
  const [connectorSchema, setConnectorSchema] = useState<ConnectorSchema | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Teams state
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [showCreateTeamPanel, setShowCreateTeamPanel] = useState(false);
  const [teamForm, setTeamForm] = useState({
    name: '',
    tags: [] as string[],
  });
  const [newTagInput, setNewTagInput] = useState('');
  const [deleteTeamConfirm, setDeleteTeamConfirm] = useState<string | null>(null);

  // Integration tag input state
  const [integrationTagInput, setIntegrationTagInput] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const config = JSON.parse(createForm.config);
      // Extract name from config
      const name = config.name || 'Unnamed Integration';

      // Validate required fields per contract
      if (!config.name || typeof config.name !== 'string') {
        alert('Integration name is required');
        return;
      }
      if (!Array.isArray(config.tags)) {
        alert('Tags must be a valid JSON array (e.g., ["tag1", "tag2"])');
        return;
      }

      await createIntegration({
        type: createForm.type,
        name: name,
        config,
      });
      setShowCreatePanel(false);
      setCreateForm({
        type: '',
        name: '',
        config: '{}',
      });
    } catch (err) {
      alert(`Failed to create integration: ${err}`);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIntegration) return;

    try {
      // Extract name from config if it exists there
      const name = editingIntegration.config.name || editingIntegration.name;

      // Validate required fields per contract
      if (!editingIntegration.config.name || typeof editingIntegration.config.name !== 'string') {
        alert('Integration name is required');
        return;
      }
      if (!Array.isArray(editingIntegration.config.tags)) {
        alert('Tags must be a valid JSON array (e.g., ["tag1", "tag2"])');
        return;
      }

      await updateIntegration(editingIntegration.id, {
        name: name,
        config: editingIntegration.config,
      });
      closePanel();
    } catch (err) {
      alert(`Failed to update integration: ${err}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteIntegration(id);
      setDeleteConfirm(null);
      closePanel();
    } catch (err) {
      alert(`Failed to delete integration: ${err}`);
    }
  };

  // Group integrations by type
  const groupedIntegrations = integrations.reduce((acc, integration) => {
    const type = integration.type;
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(integration);
    return acc;
  }, {} as Record<string, Integration[]>);

  // Filter integrations by search query
  const filteredIntegrations = Object.entries(groupedIntegrations).reduce((acc, [type, items]) => {
    const query = searchQuery.toLowerCase();

    // If search query matches the type, include all items of that type
    if (type.toLowerCase().includes(query)) {
      acc[type] = items;
      return acc;
    }

    // Otherwise filter individual integrations
    const filtered = items.filter(integration => {
      // Search in integration name
      if (integration.name?.toLowerCase().includes(query)) return true;

      // Search in config name
      if (integration.config?.name?.toLowerCase().includes(query)) return true;

      // Search in connector type
      if (integration.type?.toLowerCase().includes(query)) return true;

      // Search in tags (normalized to top-level tags field)
      if (integration.config?.tags && Array.isArray(integration.config.tags)) {
        if (integration.config.tags.some((tag: string) => tag.toLowerCase().includes(query))) {
          return true;
        }
      }

      return false;
    });

    if (filtered.length > 0) {
      acc[type] = filtered;
    }
    return acc;
  }, {} as Record<string, Integration[]>);

  const handleEdit = async (integration: Integration) => {
    setEditingIntegration(integration);
    // Load schema for the integration's connector type
    try {
      const schemaData = await getSchema(integration.type);
      const schema = schemaData.configSchema as ConnectorSchema;
      setConnectorSchema(schema);
    } catch (err) {
      console.error('Failed to fetch connector schema:', err);
      setConnectorSchema(null);
    }
  };

  const closePanel = () => {
    setEditingIntegration(null);
    setShowCreatePanel(false);
    setConnectorSchema(null);
    setCreateForm({
      type: '',
      name: '',
      config: '{}',
    });
    setIntegrationTagInput('');
  };

  // Team handlers
  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createTeam({
        name: teamForm.name,
        tags: teamForm.tags,
      });
      setShowCreateTeamPanel(false);
      setTeamForm({ name: '', tags: [] });
    } catch (err) {
      alert(`Failed to create team: ${err}`);
    }
  };

  const handleUpdateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam) return;

    try {
      await updateTeam(selectedTeam.id, {
        tags: teamForm.tags,
      });
      closeTeamPanel();
    } catch (err) {
      alert(`Failed to update team: ${err}`);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    try {
      await deleteTeam(id);
      setDeleteTeamConfirm(null);
      closeTeamPanel();
    } catch (err) {
      alert(`Failed to delete team: ${err}`);
    }
  };

  const handleEditTeam = (team: Team) => {
    setSelectedTeam(team);
    setTeamForm({
      name: team.name,
      tags: team.tags,
    });
  };

  const closeTeamPanel = () => {
    setSelectedTeam(null);
    setShowCreateTeamPanel(false);
    setTeamForm({ name: '', tags: [] });
    setNewTagInput('');
    setDeleteTeamConfirm(null);
  };

  const addTag = () => {
    if (newTagInput.trim() && !teamForm.tags.includes(newTagInput.trim())) {
      setTeamForm({
        ...teamForm,
        tags: [...teamForm.tags, newTagInput.trim()],
      });
      setNewTagInput('');
    }
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  const removeTag = (index: number) => {
    setTeamForm({
      ...teamForm,
      tags: teamForm.tags.filter((_, i) => i !== index),
    });
  };

  // Integration tag handlers
  const addIntegrationTag = (currentTags: string[]) => {
    if (integrationTagInput.trim() && !currentTags.includes(integrationTagInput.trim())) {
      const newTags = [...currentTags, integrationTagInput.trim()];
      setIntegrationTagInput('');
      return newTags;
    }
    return currentTags;
  };

  const removeIntegrationTag = (currentTags: string[], index: number) => {
    return currentTags.filter((_, i) => i !== index);
  };

  const handleIntegrationTagKeyDown = (e: React.KeyboardEvent, currentTags: string[], handleConfigChange: (key: string, value: any) => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newTags = addIntegrationTag(currentTags);
      handleConfigChange('tags', newTags);
    }
  };

  return (
    <div className="settings-layout">
      {/* Left Sidebar */}
      <aside className="settings-sidebar">
        <Link to="/" className="back-to-dashboard-btn">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Dashboard
        </Link>
        <nav>
          <button
            className={`settings-nav-item ${activeTab === 'integrations' ? 'active' : ''}`}
            onClick={() => setActiveTab('integrations')}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Integrations
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'teams' ? 'active' : ''}`}
            onClick={() => setActiveTab('teams')}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Teams
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="settings-main">
        {activeTab === 'integrations' ? (
          <>
            {/* Header */}
            <div className="settings-header">
              <div>
                <h1>Integrations</h1>
                <p>Connect external services to PainChain</p>
              </div>
              <button className="btn-primary" onClick={() => setShowCreatePanel(true)}>
                + New Integration
              </button>
            </div>

            {/* Search Bar */}
            <div className="search-bar">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search integrations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Integrations by Type */}
            <div className="integrations-list">
              {loading ? (
                <p style={{ color: '#808080', padding: '40px', textAlign: 'center' }}>Loading...</p>
              ) : Object.keys(filteredIntegrations).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <svg
                    style={{ margin: '0 auto 20px', color: '#808080' }}
                    width="48"
                    height="48"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <h3 style={{ color: '#e1e4e8', marginBottom: '8px' }}>No integrations found</h3>
                  <p style={{ color: '#808080', marginBottom: '20px' }}>Get started by creating your first integration</p>
                  <button className="btn-primary" onClick={() => setShowCreatePanel(true)}>
                    Create Integration
                  </button>
                </div>
              ) : (
                Object.entries(filteredIntegrations).map(([type, items]) => (
                  <div key={type} className="integration-group">
                    <h2 className="integration-group-title">
                      <img
                        src={`/api/integrations/types/${type}/logo`}
                        alt={type}
                        className="connector-logo"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                      <span className="integration-count">{items.length}</span>
                    </h2>
                    <div className="integration-cards">
                      {items.map((integration) => (
                        <div
                          key={integration.id}
                          className="integration-card"
                          onClick={() => handleEdit(integration)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="integration-card-header">
                            <div>
                              <h3>{integration.config?.name || integration.name || 'Unnamed Integration'}</h3>
                              <p className="integration-card-type">
                                {type.charAt(0).toUpperCase() + type.slice(1)} Connector
                              </p>
                              <p className="integration-card-meta" style={{ fontSize: '0.75em', color: '#808080', marginTop: '4px' }}>
                                ID: {integration.id}
                              </p>
                            </div>
                            <div className="integration-card-status">
                              <span className={`status-badge ${integration.status}`}>
                                {integration.status}
                              </span>
                              <p className="integration-card-meta">
                                {integration.lastSync ? new Date(integration.lastSync).toLocaleString() : 'Never'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          /* Teams Tab */
          <>
            {/* Header */}
            <div className="settings-header">
              <div>
                <h1>Teams</h1>
                <p>Organize integrations by tags and manage team subscriptions</p>
              </div>
              <button className="btn-primary" onClick={() => setShowCreateTeamPanel(true)}>
                + New Team
              </button>
            </div>

            {/* Teams List */}
            <div className="integrations-list">
              {teamsLoading ? (
                <p style={{ color: '#808080', padding: '40px', textAlign: 'center' }}>Loading...</p>
              ) : teams.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <svg
                    style={{ margin: '0 auto 20px', color: '#808080' }}
                    width="48"
                    height="48"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <h3 style={{ color: '#e1e4e8', marginBottom: '8px' }}>No teams found</h3>
                  <p style={{ color: '#808080', marginBottom: '20px' }}>Get started by creating your first team</p>
                  <button className="btn-primary" onClick={() => setShowCreateTeamPanel(true)}>
                    Create Team
                  </button>
                </div>
              ) : (
                <div className="integration-cards">
                  {teams.map((team) => (
                    <div
                      key={team.id}
                      className="integration-card"
                      onClick={() => handleEditTeam(team)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="integration-card-header">
                        <div>
                          <h3>{team.name}</h3>
                          <p className="integration-card-type">
                            {team.tags.length} tag{team.tags.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="integration-card-status">
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {team.tags.slice(0, 3).map((tag, idx) => (
                              <span key={idx} className="status-badge active" style={{ fontSize: '11px', padding: '2px 8px' }}>
                                {tag}
                              </span>
                            ))}
                            {team.tags.length > 3 && (
                              <span className="status-badge" style={{ fontSize: '11px', padding: '2px 8px' }}>
                                +{team.tags.length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Right Slide-out Panel - Integrations */}
      {(editingIntegration || showCreatePanel) && (
        <>
          <div className="panel-overlay" onClick={closePanel}></div>
          <aside className="slide-panel">
            <div className="slide-panel-header">
              <h2>{editingIntegration ? 'Edit Integration' : 'Create Integration'}</h2>
              <button className="close-btn" onClick={closePanel}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {editingIntegration && (
              <div style={{
                padding: '16px 24px',
                borderBottom: '1px solid #2a3142',
                backgroundColor: '#1a1f2e'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: '0.7em',
                      color: '#808080',
                      margin: '0 0 4px 0',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      fontWeight: 600
                    }}>
                      Integration ID
                    </p>
                    <p style={{
                      fontSize: '0.9em',
                      color: '#00E8A0',
                      fontFamily: 'monospace',
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {editingIntegration.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(editingIntegration.id);
                      // Show a brief success indicator
                      const btn = document.activeElement as HTMLButtonElement;
                      const originalText = btn.innerHTML;
                      btn.innerHTML = '✓';
                      btn.style.color = '#00E8A0';
                      setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.style.color = '';
                      }, 1000);
                    }}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#2a3142',
                      border: '1px solid #3a4152',
                      borderRadius: '4px',
                      color: '#e1e4e8',
                      cursor: 'pointer',
                      fontSize: '0.85em',
                      fontWeight: 500,
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexShrink: 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#3a4152';
                      e.currentTarget.style.borderColor = '#4a5162';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#2a3142';
                      e.currentTarget.style.borderColor = '#3a4152';
                    }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </button>
                </div>
              </div>
            )}
            <div className="slide-panel-content">
              <form onSubmit={editingIntegration ? handleUpdate : handleCreate}>
                <div className="form-group">
                  <label>Connector Type</label>
                  <select
                    value={editingIntegration?.type || createForm.type}
                    onChange={async (e) => {
                      if (!editingIntegration) {
                        const selectedType = e.target.value;
                        if (selectedType) {
                          try {
                            // Fetch schema for the selected connector type
                            const schemaData = await getSchema(selectedType);
                            const schema = schemaData.configSchema as ConnectorSchema;
                            setConnectorSchema(schema);

                            // Initialize config with default values from schema
                            const defaultConfig: Record<string, any> = {};
                            schema.fields.forEach((field: ConfigField) => {
                              if (field.type === 'textarea' && field.placeholder) {
                                try {
                                  defaultConfig[field.key] = JSON.parse(field.placeholder);
                                } catch {
                                  defaultConfig[field.key] = field.placeholder || '';
                                }
                              } else {
                                defaultConfig[field.key] = '';
                              }
                            });

                            setCreateForm({
                              ...createForm,
                              type: selectedType,
                              config: JSON.stringify(defaultConfig, null, 2)
                            });
                          } catch (err) {
                            console.error('Failed to fetch connector schema:', err);
                            setConnectorSchema(null);
                          }
                        } else {
                          setConnectorSchema(null);
                          setCreateForm({
                            ...createForm,
                            type: '',
                            config: '{}'
                          });
                        }
                      }
                    }}
                    disabled={!!editingIntegration}
                  >
                    <option value="">Select a connector...</option>
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                {(editingIntegration || createForm.type) && connectorSchema && (
                  <div className="form-group">
                  <label>Configuration</label>
                  <div className="config-fields">
                    {(() => {
                      const config = editingIntegration
                        ? editingIntegration.config
                        : (() => {
                            try {
                              return JSON.parse(createForm.config);
                            } catch {
                              return {};
                            }
                          })();

                      const handleConfigChange = (key: string, value: any) => {
                        const newConfig = { ...config, [key]: value };
                        if (editingIntegration) {
                          setEditingIntegration({...editingIntegration, config: newConfig});
                        } else {
                          setCreateForm({ ...createForm, config: JSON.stringify(newConfig, null, 2) });
                        }
                      };

                      return connectorSchema.fields.map((field: ConfigField) => {
                        const value = config[field.key];

                        // Special UI for tags field
                        if (field.key === 'tags') {
                          const tags = Array.isArray(value) ? value : [];
                          return (
                            <div key={field.key} className="config-field">
                              <label className="config-label">
                                {field.label}
                                {field.required && <span style={{ color: '#f85149' }}> *</span>}
                              </label>
                              {tags.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                                  {tags.map((tag: string, index: number) => (
                                    <span
                                      key={index}
                                      className="label-tag"
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                      }}
                                      onClick={() => {
                                        const newTags = removeIntegrationTag(tags, index);
                                        handleConfigChange('tags', newTags);
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.opacity = '0.7';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.opacity = '1';
                                      }}
                                    >
                                      {tag}
                                      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.6 }}>
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                  type="text"
                                  value={integrationTagInput}
                                  onChange={(e) => setIntegrationTagInput(e.target.value)}
                                  onKeyDown={(e) => handleIntegrationTagKeyDown(e, tags, handleConfigChange)}
                                  placeholder="Enter tag name..."
                                  style={{ flex: 1 }}
                                />
                                <button
                                  type="button"
                                  className="btn-primary"
                                  onClick={() => {
                                    const newTags = addIntegrationTag(tags);
                                    handleConfigChange('tags', newTags);
                                  }}
                                  disabled={!integrationTagInput.trim()}
                                  style={{ padding: '0 16px', minWidth: '44px' }}
                                >
                                  +
                                </button>
                              </div>
                              {field.help && (
                                <p style={{ fontSize: '0.75em', color: '#808080', marginTop: '4px', marginBottom: '0' }}>
                                  {field.help}
                                </p>
                              )}
                            </div>
                          );
                        }

                        return (
                          <div key={field.key} className="config-field">
                            <label className="config-label">
                              {field.label}
                              {field.required && <span style={{ color: '#f85149' }}> *</span>}
                            </label>
                            {field.type === 'textarea' ? (
                              <textarea
                                value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || '')}
                                onChange={(e) => {
                                  try {
                                    const parsed = JSON.parse(e.target.value);
                                    handleConfigChange(field.key, parsed);
                                  } catch {
                                    // Keep as string until valid JSON is entered
                                    // This allows the user to type without errors
                                    handleConfigChange(field.key, e.target.value);
                                  }
                                }}
                                onBlur={(e) => {
                                  // On blur, validate that the JSON is correct
                                  try {
                                    const parsed = JSON.parse(e.target.value);
                                    handleConfigChange(field.key, parsed);
                                  } catch (err) {
                                    alert(`Invalid JSON in ${field.label}: ${err}`);
                                    // Reset to empty array/object
                                    handleConfigChange(field.key, field.key === 'repositories' ? [] : {});
                                  }
                                }}
                                placeholder={field.placeholder}
                                rows={6}
                                style={{ fontFamily: 'monospace', fontSize: '13px' }}
                                required={field.required}
                              />
                            ) : field.type === 'password' ? (
                              <input
                                type="password"
                                value={String(value || '')}
                                onChange={(e) => handleConfigChange(field.key, e.target.value)}
                                placeholder={field.placeholder}
                                required={field.required}
                              />
                            ) : (
                              <input
                                type="text"
                                value={String(value || '')}
                                onChange={(e) => handleConfigChange(field.key, e.target.value)}
                                placeholder={field.placeholder}
                                required={field.required}
                              />
                            )}
                            {field.help && (
                              <p style={{ fontSize: '0.75em', color: '#808080', marginTop: '4px', marginBottom: '0' }}>
                                {field.help}
                              </p>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
                )}

                <div className="slide-panel-footer">
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="btn-secondary" onClick={closePanel}>
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary">
                      {editingIntegration ? 'Save Changes' : 'Create Integration'}
                    </button>
                  </div>
                  {editingIntegration && (
                    deleteConfirm === editingIntegration.id ? (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn-delete-confirm"
                          onClick={() => handleDelete(editingIntegration.id)}
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-delete"
                        onClick={() => setDeleteConfirm(editingIntegration.id)}
                      >
                        Delete Integration
                      </button>
                    )
                  )}
                </div>
              </form>
            </div>
          </aside>
        </>
      )}

      {/* Right Slide-out Panel - Teams */}
      {(selectedTeam || showCreateTeamPanel) && (
        <>
          <div className="panel-overlay" onClick={closeTeamPanel}></div>
          <aside className="slide-panel">
            <div className="slide-panel-header">
              <h2>{selectedTeam ? 'Edit Team' : 'Create Team'}</h2>
              <button className="close-btn" onClick={closeTeamPanel}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="slide-panel-content">
              <form onSubmit={selectedTeam ? handleUpdateTeam : handleCreateTeam}>
                <div className="form-group">
                  <label>
                    Team Name
                    {!selectedTeam && <span style={{ color: '#f85149' }}> *</span>}
                  </label>
                  <input
                    type="text"
                    value={teamForm.name}
                    onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                    placeholder="Enter team name"
                    disabled={!!selectedTeam}
                    required={!selectedTeam}
                  />
                  <p style={{ fontSize: '0.75em', color: '#808080', marginTop: '4px' }}>
                    {selectedTeam ? 'Team name cannot be changed after creation' : 'Choose a descriptive name for your team'}
                  </p>
                </div>

                <div className="form-group">
                  <label>Tags</label>
                  {teamForm.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                      {teamForm.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="label-tag"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                          onClick={() => removeTag(index)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '0.7';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '1';
                          }}
                        >
                          {tag}
                          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.6 }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={handleTagInputKeyDown}
                      placeholder="Enter tag name..."
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={addTag}
                      disabled={!newTagInput.trim()}
                      style={{ padding: '0 16px', minWidth: '44px' }}
                    >
                      +
                    </button>
                  </div>
                  <p style={{ fontSize: '0.75em', color: '#808080', marginTop: '4px' }}>
                    Add tags to organize and filter your integrations (click tag to remove)
                  </p>
                </div>

                <div className="slide-panel-footer">
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="btn-secondary" onClick={closeTeamPanel}>
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary">
                      {selectedTeam ? 'Save Changes' : 'Create Team'}
                    </button>
                  </div>
                  {selectedTeam && (
                    deleteTeamConfirm === selectedTeam.id ? (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn-delete-confirm"
                          onClick={() => handleDeleteTeam(selectedTeam.id)}
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={() => setDeleteTeamConfirm(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-delete"
                        onClick={() => setDeleteTeamConfirm(selectedTeam.id)}
                      >
                        Delete Team
                      </button>
                    )
                  )}
                </div>
              </form>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
