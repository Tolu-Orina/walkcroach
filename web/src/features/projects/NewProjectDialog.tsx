import { NameCreateDialog } from '../../components/product/NameCreateDialog';

type NewProjectDialogProps = {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
};

/** @deprecated Prefer NameCreateDialog — kept for any remaining imports. */
export function NewProjectDialog(props: NewProjectDialogProps) {
  return (
    <NameCreateDialog
      open={props.open}
      creating={props.creating}
      title="New project"
      description="A place for chats, documents, and standing instructions."
      defaultName="Untitled project"
      confirmLabel="Create project"
      onClose={props.onClose}
      onCreate={props.onCreate}
    />
  );
}
