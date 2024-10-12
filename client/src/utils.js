const formatDate = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);

  const options = { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true };
  const formattedDate = date.toLocaleString('en-US', options);

//   return formattedDate.replace(',', '');
  return formattedDate;
}

export {formatDate};