
import React from 'react';
import {
  List,
  ListSubheader,
} from '@mui/material';
import TaskCard from '../TaskCard';

const TaskList = ({ title, tasks }) => {
  return (
    <List
      subheader={<ListSubheader>{title}</ListSubheader>}
    >
      {tasks.map((task) => (
        <TaskCard key={task._id} task={task} />
      ))}
    </List>
  );
};

export default TaskList;
