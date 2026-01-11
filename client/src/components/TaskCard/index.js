import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Checkbox,
  Chip,
  IconButton,
  Typography,
} from '@mui/material';
import {
  Edit as EditIcon,
} from '@mui/icons-material';
import TaskModal from '../TaskModal';
import { formatDate } from '../../utils';
import { getTagName } from '../../services/tag';
import { updateTask } from '../../services/task';
import { useTasks } from '../../TaskProvider';

const TaskCard = ({ task }) => {
  const { refreshTasks } = useTasks();
  const [tags, setTags] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchTags = async () => {
      try {
        const tagNames = await Promise.all(task.tags.map((tag) => getTagName(tag)));
        setTags(tagNames || []);
      } catch (error) {
        // TODO: Figure out what to do with errors
      }
    };

    fetchTags();
  }, [task.tags]);

  return (
    <>
      <TaskModal
        task={task}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6">{task.title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {formatDate(task.due_date)}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {tags.map((tag, index) => (
              <Chip key={index} label={tag} size="small" />
            ))}
          </Box>
        </CardContent>
        <CardActions disableSpacing>
          <Checkbox
            checked={task.is_completed}
            onChange={async () => {
              await updateTask(task._id, { is_completed: !task.is_completed });
              await refreshTasks();
            }}
          />
          <IconButton
            aria-label="edit"
            onClick={() => {
              setOpen(true);
            }}
          >
            <EditIcon />
          </IconButton>
        </CardActions>
      </Card>
    </>
  );
};

export default TaskCard;
