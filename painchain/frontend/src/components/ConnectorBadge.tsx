interface ConnectorBadgeProps {
  connector: string;
}

const connectorColors: Record<string, string> = {
  github: '#9f7aea', // Purple
  gitlab: '#fc6d26', // Orange
  kubernetes: '#326ce5', // Blue
  k8s: '#326ce5', // Blue
};

const CONNECTOR_LOGOS: Record<string, string> = {
  github: '/api/integrations/types/github/logo',
  gitlab: '/api/integrations/types/gitlab/logo',
  kubernetes: '/api/integrations/types/kubernetes/logo',
  k8s: '/api/integrations/types/kubernetes/logo',
};

export function ConnectorBadge({ connector }: ConnectorBadgeProps) {
  const color =
    connectorColors[connector.toLowerCase()] || '#6b7280'; // Gray fallback
  const logoUrl = CONNECTOR_LOGOS[connector.toLowerCase()];

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border"
      style={{
        backgroundColor: `${color}20`,
        borderColor: `${color}60`,
        color: color,
      }}
    >
      {logoUrl && (
        <img
          src={logoUrl}
          alt={`${connector} logo`}
          style={{ width: '14px', height: '14px', objectFit: 'contain' }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      <span>{connector}</span>
    </span>
  );
}
