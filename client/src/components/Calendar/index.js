import { useState, useEffect } from 'react';
import './index.css';

const Calendar = ({tasks}) => {
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timeSlots = generateTimeSlots();
  
  // Example events with start time (in 24-hour format) and duration (in minutes)
  const events = [
    { day: 'Monday', startHour: 9, startMinute: 0, duration: 90, title: 'some monday event' },
    { day: 'Tuesday', startHour: 14, startMinute: 30, duration: 45, title: 'tuesday event' },
    { day: 'Wednesday', startHour: 16, startMinute: 15, duration: 120, title: 'wednesday' },
  ];

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);


  const calculateCurrentTimePosition = () => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    const slotHeight = 60; // Height of each hour slot in pixels
    return (hours * slotHeight) + (minutes / 60) * slotHeight + slotHeight;
  };

  const currentTimeTop = calculateCurrentTimePosition();

  const getEventStyle = (startHour, startMinute, duration) => {
    const slotHeight = 60;
    const top = (startHour * slotHeight) + (startMinute / 60) * slotHeight;
    const height = (duration / 60) * slotHeight;
    return { top: `${top}px`, height: `${height}px` };
  };

  return (
    <div className="calendar-week-container">
      <div className="calendar-week">
        <div className="header">
          <div className="time-slot-header"></div>
          {daysOfWeek.map(day => (
            <div key={day} className="day-header">{day}</div>
          ))}
        </div>
        
        <div className="grid">
          {timeSlots.map((time, index) => (
            <div key={index} className="time-slot">
              <div className="time-label">{time}</div>
              {daysOfWeek.map((day, dayIndex) => (
                <div key={`${day}-${index}`} className="slot"></div>
              ))}
            </div>
          ))}

          {/* Render events */}
          {events.map((event, index) => (
            <div
              key={index}
              className="event"
              style={{
                ...getEventStyle(event.startHour, event.startMinute, event.duration),
                gridColumn: `${daysOfWeek.indexOf(event.day) + 2} / span 1`
              }}
            >
              {event.title}
            </div>
          ))}
        </div>

        {/* Current Time Line */}
        <div 
          className="current-time-line" 
          style={{ top: `${currentTimeTop}px` }}
        ></div>
      </div>
    </div>
  );
};

// Generate time slots for each hour from 12:00 AM to 11:00 PM
const generateTimeSlots = () => {
  const slots = [];
  for (let hour = 0; hour < 24; hour++) {
    const timeString = `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
    slots.push(timeString);
  }
  return slots;
};

export default Calendar;
