import { useParams } from 'react-router-dom';
import { TerminalView } from '../components/TerminalView';

export function TerminalPage() {
  const { workspaceId = '' } = useParams();
  return <TerminalView key={workspaceId} workspaceId={workspaceId} />;
}
