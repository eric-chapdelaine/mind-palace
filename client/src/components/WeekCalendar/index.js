import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Grid,
  Tooltip,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';

const getDateString = (date) => {
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${month}/${day}`;
};

const getDayFromLastSunday = (offset) => {
  const result = new Date();
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - result.getDay() + offset);
  return result;
};

const getDayFromGiven = (day, offset) => {
  const result = new Date(day);
  result.setDate(result.getDate() + offset);
  return result;
};

const generateTimeSlots = () => {
  const slots = [];
  for (let hour = 0; hour < 24; hour++) {
    const timeString = `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
    slots.push(timeString);
  }
  return slots;
};

const CalendarWeekContainer = styled('div')({
  position: 'relative',
  height: '100vh',
  minWidth: '500px',
  overflow: 'auto',
  border: '1px solid #ddd',
});

const CalendarWeek = styled('div')({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'Arial, sans-serif',
});

const Header = styled('div')(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: '100px repeat(7, 1fr)',
  textAlign: 'center',
  backgroundColor: theme.palette.background.paper,
  padding: '10px 0',
  borderBottom: '1px solid #ccc',
  position: 'sticky',
  top: 0,
  zIndex: 10,
}));

const TimeSlotHeader = styled('div')({
  border: 'none',
  fontSize: '8px',
});

const DayHeader = styled('div')({
  fontWeight: 'bold',
  padding: '8px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

const GridContainer = styled('div')({
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '100px repeat(7, 1fr)',
});

const TimeSlot = styled('div')({
  display: 'contents',
});

const TimeLabel = styled('div')(({ theme }) => ({
  gridColumn: '1 / 2',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.85em',
  padding: '4px',
  borderRight: '1px solid #ccc',
  backgroundColor: theme.palette.background.paper,
}));

const Slot = styled('div')({
  border: '1px solid #eee',
  boxSizing: 'border-box',
  height: '60px',
  position: 'relative',
  cursor: 'pointer',
});

const Event = styled('div')(({ theme }) => ({
  position: 'absolute',
  left: '2px',
  right: '2px',
  backgroundColor: theme.palette.primary.light,
  color: theme.palette.primary.contrastText,
  fontSize: '0.8em',
  borderRadius: '4px',
  textAlign: 'center',
  zIndex: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}));

const CurrentTimeLine = styled('div')(({ theme }) => ({
  position: 'absolute',
  left: '100px',
  right: 0,
  height: '2px',
  backgroundColor: theme.palette.error.main,
  zIndex: 5,
  pointerEvents: 'none',
}));

const WeekCalendar = ({ tasks }) => {
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timeSlots = generateTimeSlots();

  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentSunday, setCurrentSunday] = useState(getDayFromLastSunday(0));
  const [nextSunday, setNextSunday] = useState(getDayFromLastSunday(7));

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const next = new Date(currentSunday);
    next.setDate(next.getDate() + 7);
    setNextSunday(next);
  }, [currentSunday]);

  const scheduledTasksThisWeek = tasks
    .flatMap((task) =>
      task.scheduled_times.map((st) => ({ scheduled_time: st, task: task }))
    )
    .filter((displayEvent) => {
      const start_time = new Date(displayEvent.scheduled_time.start_time).getTime();
      return start_time > currentSunday.getTime() && start_time < nextSunday.getTime();
    });

  const dueDatesThisWeek = tasks.filter((event) => {
    const due_date = new Date(event.due_date).getTime();
    return due_date > currentSunday.getTime() && due_date < nextSunday.getTime();
  });

  const calculateCurrentTimePosition = () => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    const slotHeight = 60; // Height of each hour slot in pixels
    return hours * slotHeight + (minutes / 60) * slotHeight + slotHeight;
  };

  const currentTimeTop = calculateCurrentTimePosition();

  const getScheduledTaskStyle = (scheduled_time) => {
    const start_time = new Date(scheduled_time.start_time);
    const end_time = new Date(scheduled_time.end_time);
    const slotHeight = 60;
    const top = (start_time.getHours() * slotHeight) + (start_time.getMinutes() / 60) * slotHeight;
    const height = ((end_time.getTime() - start_time.getTime()) / 3600000) * slotHeight;
    return {
      top: `${top}px`,
      height: `${height}px`,
    };
  };

  const getDueDateStyle = (task) => {
    const start_time = new Date(task.due_date);
    const end_time = new Date(start_time.getTime() + 15 * 60000);
    const slotHeight = 60;
    const top = (start_time.getHours() * slotHeight) + (start_time.getMinutes() / 60) * slotHeight;
    const height = ((end_time.getTime() - start_time.getTime()) / 3600000) * slotHeight;
    return {
      top: `${top}px`,
      height: `${height}px`,
      backgroundColor: '#fab0a0',
    };
  };

  return (
    <CalendarWeekContainer>
      <CalendarWeek>
        <Header>
          <TimeSlotHeader>
            <Button
              onClick={() => {
                const newSunday = new Date(currentSunday);
                newSunday.setDate(currentSunday.getDate() - 7);
                setCurrentSunday(newSunday);
              }}
            >
              &lt;
            </Button>
            <Button
              onClick={() => {
                setCurrentSunday(getDayFromLastSunday(0));
              }}
            >
              Reset
            </Button>
            <Button
              onClick={() => {
                const newSunday = new Date(currentSunday);
                newSunday.setDate(currentSunday.getDate() + 7);
                setCurrentSunday(newSunday);
              }}
            >
              &gt;
            </Button>
          </TimeSlotHeader>
          {daysOfWeek.map((day, index) => (
            <DayHeader key={day}>
              {day}
              <br />
              {getDateString(getDayFromGiven(currentSunday, index))}
            </DayHeader>
          ))}
        </Header>

        <GridContainer>
          {timeSlots.map((time, index) => (
            <TimeSlot key={index}>
              <TimeLabel>{time}</TimeLabel>
              {daysOfWeek.map((day, index) => (
                <Slot key={`${day}-${index}`}></Slot>
              ))}
            </TimeSlot>
          ))}

          {scheduledTasksThisWeek.map((event, index) => (
            <Tooltip key={index} title={event.task.title}>
              <Event
                style={{
                  ...getScheduledTaskStyle(event.scheduled_time),
                  gridColumn: `${new Date(event.scheduled_time.start_time).getDay() + 2} / span 1`,
                }}
              >
                {event.task.title}
              </Event>
            </Tooltip>
          ))}

          {dueDatesThisWeek.map((task, index) => (
            <Tooltip key={index} title={task.title}>
              <Event
                style={{
                  ...getDueDateStyle(task),
                  gridColumn: `${new Date(task.due_date).getDay() + 2} / span 1`,
                }}
              >
                {task.title}
              </Event>
            </Tooltip>
          ))}
        </GridContainer>

        <CurrentTimeLine style={{ top: `${currentTimeTop}px` }} />
      </CalendarWeek>
    </CalendarWeekContainer>
  );
};

export default WeekCalendar;
