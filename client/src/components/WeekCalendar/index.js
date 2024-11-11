import { useState, useEffect } from 'react';
import './index.css';

// TODO: have it take in week as well
const WeekCalendar = ({ tasks }) => {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const timeSlots = generateTimeSlots();

    const previousSunday = new Date();
    previousSunday.setHours(0, 0, 0, 0);
    previousSunday.setDate(previousSunday.getDate() - previousSunday.getDay());

    const daysUntilSunday = (7 - previousSunday.getDay());
    const nextSunday = new Date();
    nextSunday.setDate(previousSunday.getDate() + daysUntilSunday);
    nextSunday.setHours(23, 59, 0, 0);

    const scheduledTasksThisWeek = tasks
        .flatMap((task) =>
            task.scheduled_times.map((st) => ({ scheduled_time: st, task: task }))
        )
        .filter((displayEvent) => {
            const start_time = new Date(displayEvent.scheduled_time.start_time).getTime();
            return start_time > previousSunday.getTime() && start_time < nextSunday.getTime();
    });

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

    const getEventStyle = (event) => {
        const start_time = new Date(event.scheduled_time.start_time);
        const end_time = new Date(event.scheduled_time.end_time);
        const slotHeight = 60;
        const top = (start_time.getHours() * slotHeight) + (start_time.getMinutes() / 60) * slotHeight;
        const height = ((end_time.getTime() - start_time.getTime())/ 3600000) * slotHeight;
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
                    {/* Render scheduled times*/}
        
                     {scheduledTasksThisWeek.map((event, index) => (
                         <div
                             key={index}
                             className="event"
                             style={{
                                 ...getEventStyle(event),
                                 gridColumn: `${new Date(event.scheduled_time.start_time).getDay() + 2} / span 1`
                             }}
                         >
                             {event.task.title}
                         </div>
                     ))}
                </div>
                {/* Render due dates*/}

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

export default WeekCalendar;
