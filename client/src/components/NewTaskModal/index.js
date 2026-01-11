import React, { useState, useEffect } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useTasks } from '../../TaskProvider';
import { createTask } from '../../services/task';
import { createTagsFromCSV } from '../../utils';

const NewTaskModal = ({ open, onClose }) => {
  const { refreshTasks } = useTasks();

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [dueDate, setDueDate] = useState(undefined);
  const [tags, setTags] = useState('');

  useEffect(() => {
    setTitle('');
    setDesc('');
    setDueDate(undefined);
    setTags('');
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Create New Task</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Title"
          type="text"
          fullWidth
          variant="standard"
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          margin="dense"
          label="Tags (comma-separated)"
          type="text"
          fullWidth
          variant="standard"
          onChange={(e) => setTags(e.target.value)}
        />
        <TextField
          margin="dense"
          label="Description"
          type="text"
          fullWidth
          multiline
          rows={4}
          variant="standard"
          onChange={(e) => setDesc(e.target.value)}
        />
        <TextField
          margin="dense"
          label="Due Date"
          type="datetime-local"
          fullWidth
          InputLabelProps={{
            shrink: true,
          }}
          variant="standard"
          onChange={(e) =>
            setDueDate(new Date(e.target.value).toISOString())
          }
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={async () => {
            let tag_array = await createTagsFromCSV(tags);
            await createTask({
              title: title,
              description: desc,
              due_date: dueDate,
              tags: tag_array,
            });
            await refreshTasks();
            onClose();
          }}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewTaskModal;
