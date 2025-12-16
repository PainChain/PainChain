// Connector metadata module
// Dynamically loads connector metadata from backend

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

let cachedMetadata = null

/**
 * Load connector metadata from backend
 * Returns array of connector metadata objects with:
 * - id: connector identifier
 * - displayName: human-readable name
 * - color: hex color code
 * - logo: logo filename
 * - description: connector description
 */
export const loadConnectorMetadata = async () => {
  if (cachedMetadata) {
    return cachedMetadata
  }

  try {
    const response = await fetch(`${API_URL}/api/connectors/metadata`)
    if (!response.ok) {
      throw new Error('Failed to load connector metadata')
    }

    cachedMetadata = await response.json()
    return cachedMetadata
  } catch (error) {
    console.error('Error loading connector metadata:', error)
    // Return empty array - all metadata should come from backend
    return []
  }
}

/**
 * Get metadata for a specific connector
 */
export const getConnectorMetadata = async (connectorId) => {
  const metadata = await loadConnectorMetadata()
  return metadata.find(m => m.id === connectorId)
}

/**
 * Get connector color
 */
export const getConnectorColor = async (connectorId) => {
  const metadata = await getConnectorMetadata(connectorId)
  return metadata?.color || '#666666'
}

/**
 * Get connector display name
 */
export const getConnectorDisplayName = async (connectorId) => {
  const metadata = await getConnectorMetadata(connectorId)
  return metadata?.displayName || connectorId
}

/**
 * Get connector logo URL
 */
export const getConnectorLogoUrl = (connectorId) => {
  return `${API_URL}/api/connectors/${connectorId}/logo`
}

/**
 * Get all connector colors as an object
 * Returns: { github: '#00E8A0', gitlab: '#fc6d26', ... }
 */
export const getAllConnectorColors = async () => {
  const metadata = await loadConnectorMetadata()
  const colors = {}
  metadata.forEach(m => {
    colors[m.id] = m.color
  })
  return colors
}

/**
 * Inject dynamic CSS for source badges
 * This creates .source-badge.{connector-id} classes dynamically
 */
export const injectConnectorStyles = async () => {
  const metadata = await loadConnectorMetadata()

  // Check if already injected
  if (document.getElementById('connector-dynamic-styles')) {
    return
  }

  const style = document.createElement('style')
  style.id = 'connector-dynamic-styles'

  let css = ''
  metadata.forEach(connector => {
    const { id, color } = connector
    // Convert hex to rgba for background
    const rgb = hexToRgb(color)

    css += `
.source-badge.${id} {
  background-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1);
  color: ${color};
  border: 1px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3);
}
`
  })

  style.textContent = css
  document.head.appendChild(style)
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex) {
  // Remove # if present
  hex = hex.replace('#', '')

  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  return { r, g, b }
}

/**
 * Get connector types for UI
 * Returns array: [{ id: 'github', name: 'GitHub' }, ...]
 */
export const getConnectorTypes = async () => {
  const metadata = await loadConnectorMetadata()
  return metadata.map(m => ({
    id: m.id,
    name: m.displayName
  }))
}
