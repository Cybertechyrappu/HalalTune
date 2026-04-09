import { Innertube } from 'youtubei.js';

let _client = null;

export async function getClient() {
  if (!_client) {
    _client = await Innertube.create({
      lang: 'en',
      location: 'US',
      retrieve_player: false,
    });
  }
  return _client;
}

let _playerClient = null;

export async function getPlayerClient() {
  if (!_playerClient) {
    _playerClient = await Innertube.create({
      lang: 'en',
      location: 'US',
    });
  }
  return _playerClient;
}
