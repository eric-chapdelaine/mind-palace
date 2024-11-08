# Mind Palace!

# TODO

- [ ] Figure out a more robust way to display tasks (maybe based on tags?)
  * add the ability to reorder tasks in a task list
- [ ] add markdown/latex support for description
- [ ] Add time logging implementation
  * add activities attached to scheduled times
- [ ] add tags
  * finish dependency logic in server
  * add tag input in new task modal
  * display tags in task modal
  * have some visual difference between dependent tags and primary tags
- [ ] Have the schedule displayed
  * Google Calendar integration
- [ ] Improve frontend look/feel


# Installation

Clone repo into local directory:

`git clone https://github.com/eric-chapdelaine/mind-palace/`

Install dependencies for `client/`:

`cd client`

`npm install`

Install depdencies for `server/`

`cd server`

`npm install`

Run application (in repo directory):

`docker-compose up -d`
