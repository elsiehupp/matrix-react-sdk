/*
Copyright 2017 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import MatrixClientPeg from "./MatrixClientPeg";

export const host = "matrix.to";
export const baseUrl = `https://${host}`;

export function makeEventPermalink(roomId, eventId) {
    const serverCandidates = pickServerCandidates(roomId);
    return `${baseUrl}/#/${roomId}/${eventId}?${encodeServerCandidates(serverCandidates)}`;
}

export function makeUserPermalink(userId) {
    return `${baseUrl}/#/${userId}`;
}

export function makeRoomPermalink(roomId) {
    const serverCandidates = pickServerCandidates(roomId);
    return `${baseUrl}/#/${roomId}?${encodeServerCandidates(serverCandidates)}`;
}

export function makeGroupPermalink(groupId) {
    return `${baseUrl}/#/${groupId}`;
}

export function encodeServerCandidates(candidates) {
    if (!candidates) return '';
    return `via=${candidates.map(c => encodeURIComponent(c)).join("&via=")}`
}

export function pickServerCandidates(roomId) {
    const client = MatrixClientPeg.get();
    const room = client.getRoom(roomId);
    if (!room) return [];

    // Permalinks can have servers appended to them so that the user
    // receiving them can have a fighting chance at joining the room.
    // These servers are called "candidates" at this point because
    // it is unclear whether they are going to be useful to actually
    // join in the future.
    //
    // We pick 3 servers based on the following criteria:
    //
    //   Server 1: The highest power level user in the room, provided
    //   they are at least PL 50. We don't calculate "what is a moderator"
    //   here because it is less relevant for the vast majority of rooms.
    //   We also want to ensure that we get an admin or high-ranking mod
    //   as they are less likely to leave the room. If no user happens
    //   to meet this criteria, we'll pick the most popular server in the
    //   room.
    //
    //   Server 2: The next most popular server in the room (in user
    //   distribution). This will probably be matrix.org in most cases
    //   although it is certainly possible to be some other server. This
    //   cannot be the same as Server 1. If no other servers are available
    //   then we'll only return Server 1.
    //
    //   Server 3: The next most popular server by user distribution. This
    //   has the same rules as Server 2, with the added exception that it
    //   must be unique from Server 1 and 2.

    // Rationale for popular servers: It's hard to get rid of people when
    // they keep flocking in from a particular server. Sure, the server could
    // be ACL'd in the future or for some reason be evicted from the room
    // however an event like that is unlikely the larger the room gets.

    // Note: Users receiving permalinks that happen to have all 3 potential
    // servers fail them (in terms of joining) are somewhat expected to hunt
    // down the person who gave them the link to ask for a participating server.
    // The receiving user can then manually append the known-good server to
    // the list and magically have the link work.

    const populationMap: {[server:string]:number} = {};
    const highestPlUser = {userId:null, powerLevel: 0, serverName: null};

    for (const member of room.getJoinedMembers()) {
        const serverName = member.userId.split(":").splice(1).join(":");
        if (member.powerLevel > highestPlUser.powerLevel) {
            highestPlUser.userId = member.userId;
            highestPlUser.powerLevel = member.powerLevel;
            highestPlUser.serverName = serverName;
        }

        if (!populationMap[serverName]) populationMap[serverName] = 0;
        populationMap[serverName]++;
    }

    const candidates = [];
    if (highestPlUser.powerLevel >= 50) candidates.push(highestPlUser.serverName);

    const maxCandidates = 3;
    const serversByPopulation = Object.keys(populationMap)
        .sort((a, b) => populationMap[a] - populationMap[b])
        .filter(a => !candidates.includes(a));
    while(candidates.length < maxCandidates && candidates.length <= serversByPopulation.length) {
        candidates.push(serversByPopulation[Math.max(0, candidates.length - 1)]);
    }

    return candidates;
}