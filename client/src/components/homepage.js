import React, { useState } from 'react';
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  Fab,
  Grid,
  IconButton,
  Toolbar,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Menu as MenuIcon,
} from '@mui/icons-material';
import TaskList from './TaskList';
import NewTaskModal from './NewTaskModal';
import WeekCalendar from './WeekCalendar';
import { useTasks } from '../TaskProvider';
import { displayToday, displayThisWeek, displayEventually, sortByDateCompleted } from '../utils';

const drawerWidth = 240;

export default function Homepage() {
  const { tasks, error } = useTasks();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  if (error) {
    return <Typography color="error">Error occurred: {error.message}</Typography>;
  }

  const drawer = (
    <div>
      <Toolbar />
      <TaskList title="Today" tasks={tasks.filter(displayToday)} />
      <TaskList title="This Week" tasks={tasks.filter(displayThisWeek)} />
      <TaskList title="Eventually" tasks={tasks.filter(displayEventually)} />
      <TaskList title="Completed" tasks={tasks.filter((t) => t.is_completed).sort(sortByDateCompleted)} />
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div">
            Mind Palace
          </Typography>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
        aria-label="mailbox folders"
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{ flexGrow: 1, p: 3, width: { sm: `calc(100% - ${drawerWidth}px)` } }}
      >
        <Toolbar />
        <WeekCalendar tasks={tasks} />
        <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
        <Fab
          color="secondary"
          aria-label="add"
          sx={{
            position: 'fixed',
            bottom: 16,
            right: 16,
          }}
          onClick={() => setNewTaskOpen(true)}
        >
          <AddIcon />
        </Fab>
      </Box>
    </Box>
  );
}
