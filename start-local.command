#!/bin/zsh

set -e
cd "$(dirname "$0")/server"

if [ ! -d node_modules ]; then
  npm install
fi

npm start &
server_pid=$!
sleep 1
open "http://localhost:3000/local/"
wait "$server_pid"
