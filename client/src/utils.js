export const formatDate = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);

  const options = { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true, timeZone: 'America/New_York' };
  const formattedDate = date.toLocaleString('en-US', options);

//   return formattedDate.replace(',', '');
  return formattedDate;
}

export const anyScheduledTimesToday = (task) => {
    return !task.is_completed && task.scheduled_times.some((time_block) => 
        new Date(time_block.start_time).getDate() === new Date().getDate()
    );
}

export const anyScheduledTimesThisWeek = (task) => {
    const today = new Date();
    const daysUntilSunday = (7 - today.getDay()) % 7;
    const sunday = new Date();
    sunday.setDate(today.getDate() + daysUntilSunday);
    sunday.setHours(23, 59, 0, 0);
    today.setHours(23, 59, 0, 0);

    return !task.is_completed && task.scheduled_times.some((time_block) => {
        const start_time = new Date(time_block.start_time).getTime(); 
        return start_time > today.getTime() && start_time < sunday.getTime()
    });
}

export const anyScheduledTimesEventually = (task) => {
    const today = new Date();
    const daysUntilSunday = (7 - today.getDay()) % 7;
    const sunday = new Date();
    sunday.setDate(today.getDate() + daysUntilSunday);
    sunday.setHours(23, 59, 0, 0);

    return !task.is_completed && (task.scheduled_times.length === 0 || task.scheduled_times.some((time_block) => {
        const start_time = new Date(time_block.start_time).getTime(); 
        return start_time > sunday.getTime();
    }));
}
