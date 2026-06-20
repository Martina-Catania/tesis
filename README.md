# catania-tesis

Cloned Facebook's whatsapp-business-jaspers-market app for testing whatsapp api
Added handler to fix issue with arg phone numbers (+54 9 is not a valid area code when sending messages, only when recieving)

To run: 
1- npm install (node v20.20.2 used)
2- sudo sysctl vm.overcommit_memory=1
3- redis-server --daemonize yes
4- ngrok http 8080
5- npm run start
6- check if app is running
7- add ngrok url to whatsapp business portal config