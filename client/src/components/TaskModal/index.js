
import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { formatDate } from '../../utils';
import { updateTask, addScheduledTime, deleteTask } from '../../services/task';
import { getTagName } from '../../services/tag';
import { deleteTimeBlock } from '../../services/time_block';
import { useTasks } from '../../TaskProvider';
import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import remarkGfm from 'remark-gfm';

const dateToDisplay = (date) => {
  const newDate = new Date(new Date(date) - 4 * 60 * 60 * 1000);
  return newDate.toISOString().slice(0, 16);
};

const TaskModal = ({ task, open, onClose }) => {
  const { refreshTasks } = useTasks();

  const [isDescEdit, setDescEdit] = useState(false);
  const [desc, setDesc] = useState(task?.description);

  const [isTitleEdit, setTitleEdit] = useState(false);
  const [title, setTitle] = useState(task?.title);

  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());

  const [tags, setTags] = useState([]);

  useEffect(() => {
    const fetchTagNames = async () => {
      if (!task?.tags) return;
      const resolvedTags = await Promise.all(
        task.tags.map((tag) => getTagName(tag))
      );
      setTags(resolvedTags);
    };
    fetchTagNames();
  }, [task]);

  if (!open) return null;

  const update = async () => {
    if (isDescEdit) setDescEdit(false);
    if (isTitleEdit) setTitleEdit(false);
    if (desc !== task.description) {
      await updateTask(task._id, { description: desc });
      await refreshTasks();
    }
    if (title !== task.title) {
      await updateTask(task._id, { title: title });
      refreshTasks();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} onBackdropClick={update}>
      <DialogTitle>
        {isTitleEdit ? (
          <TextField
            defaultValue={task.title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={update}
            autoFocus
          />
        ) : (
          <>
            {task.title}
            <IconButton onClick={() => setTitleEdit(true)}>
              <EditIcon />
            </IconButton>
            <IconButton
              onClick={async () => {
                onClose();
                await deleteTask(task._id);
                await refreshTasks();
              }}
            >
              <DeleteIcon />
            </IconButton>
          </>
        )}
      </DialogTitle>
      <DialogContent>
        {task.due_date && (
          <Typography variant="body2" color="text.secondary">
            Due: {formatDate(task.due_date)}
          </Typography>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {tags.map((tag, index) => (
            <Chip key={index} label={tag} size="small" />
          ))}
        </Box>
        <Checkbox
          checked={task.is_completed}
          onChange={async () => {
            await updateTask(task._id, { is_completed: !task.is_completed });
            await refreshTasks();
          }}
        />
        Completed
        <hr />
        {isDescEdit ? (
          <TextField
            defaultValue={task.description}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={update}
            multiline
            rows={4}
            fullWidth
            autoFocus
          />
        ) : (
          <div onClick={() => setDescEdit(true)}>
            <Markdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
              {task.description}
            </Markdown>
          </div>
        )}
        <Typography variant="h6">Scheduled Times:</Typography>
        <List>
          {task.scheduled_times.map((time) => (
            <ListItem
              key={time._id}
              secondaryAction={
                <IconButton
                  edge="end"
                  aria-label="delete"
                  onClick={async () => {
                    await deleteTimeBlock(time._id);
                    await refreshTasks();
                  }}
                >
                  <DeleteIcon />
                </IconButton>
              }
            >
              <ListItemText
                primary={`${formatDate(time.start_time)} - ${formatDate(
                  time.end_time
                )}`}
              />
            </ListItem>
          ))}
        </List>
        <TextField
          label="New Scheduled Time Start"
          type="datetime-local"
          value={dateToDisplay(startDate)}
          onChange={(e) => {
            setStartDate(new Date(e.target.value).toISOString());
            setEndDate(
              new Date(
                new Date(e.target.value).getTime() + 30 * 60 * 1000
              ).toISOString()
            );
          }}
          InputLabelProps={{
            shrink: true,
          }}
        />
        <TextField
          label="New Scheduled Time End"
          type="datetime-local"
          value={dateToDisplay(endDate)}
          onChange={(e) => setEndDate(new Date(e.target.value).toISOString())}
          InputLabelProps={{
            shrink: true,
          }}
        />
        <Button
          onClick={async () => {
            await addScheduledTime(task._id, {
              start_time: startDate,
              end_time: endDate,
            });
            await refreshTasks();
          }}
        >
          Add
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default TaskModal;

