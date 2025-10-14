import { createTag } from "./services/tag"

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
        return start_time >= sunday.getTime();
    }) || task.scheduled_times.every((time_block) => {
        const start_date = new Date(time_block.start_time).getDate(); 
        return start_date < today.getDate();
    }));
}

export const isDueToday = (task) => {
    const due_date = new Date(task.due_date);
    if (due_date) {
        return !task.is_completed && due_date.getDate() === new Date().getDate();
    } else {
        return false;
    }
}

export const isDueThisWeek = (task) => {
    const due_date = new Date(task.due_date);
    const today = new Date();
    const daysUntilSunday = (7 - today.getDay()) % 7;
    const sunday = new Date();
    sunday.setDate(today.getDate() + daysUntilSunday);
    sunday.setHours(23, 59, 0, 0);
    today.setHours(23, 59, 0, 0);

    return !task.is_completed && due_date && due_date.getTime() > today.getTime() && due_date.getTime() < sunday.getTime();
}

export const displayToday = (task) => {
    return anyScheduledTimesToday(task) || isDueToday(task);
}

export const displayThisWeek = (task) => {
    return (anyScheduledTimesThisWeek(task) || isDueThisWeek(task)) && !displayToday(task);
}

export const displayEventually = (task) => {
    return !displayToday(task) && !displayThisWeek(task) && !task.is_completed;
}

export const createTagsFromCSV = (tags) => {
    if (!tags || tags === "") return [];
    const tag_array = tags.split(', ');
    const result = tag_array.map(async (title) => {
        const tag = await createTag({title: title});
        console.log(tag);
        return tag;
    });
    return Promise.all(result).then((values) => {
        return values;
    });
}

export const sortByDateCompleted = (a, b) => {
    // TODO: delete these two undefined checks once all database objects have date_completed
    if (!a.date_completed) return b;
    if (!b.date_completed) return a;
    return new Date(b.date_completed).getTime() - new Date(a.date_completed).getTime();
}
