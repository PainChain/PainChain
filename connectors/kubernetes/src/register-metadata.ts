import fs from 'fs';
import path from 'path';

export async function registerMetadata(backendApiUrl: string): Promise<void> {
  try {
    // Read metadata.json from the connector directory
    const metadataPath = path.join(__dirname, '..', 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    // Register with backend
    const response = await fetch(
      `${backendApiUrl}/integrations/types/register`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register connector metadata: ${error}`);
    }

    const result = await response.json() as { displayName: string };
    console.log(`✓ Registered connector type: ${result.displayName}`);
  } catch (error) {
    console.error('Failed to register connector metadata:', error);
    throw error;
  }
}
