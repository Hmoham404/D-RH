"""Read attendance through pyzk; never disable, clear or configure a terminal."""
import argparse
import contextlib
import io
import ipaddress
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.pointage-tools' / 'python'))


def read_device(device, first_day, last_day, timeout, zk_factory):
    connection = None
    result = {'name': device['name'], 'host': device['host'], 'connected': False}
    try:
        address = ipaddress.ip_address(device['host'])
        if address.version != 4 or not address.is_private:
            raise ValueError('invalid_address')
        # The communication key is distinct from a Windows/server password.
        key_name = device.get('communicationKeyEnv', 'POINTAGE_COMM_KEY_' + device['host'].split('.')[-1])
        key = int(os.environ.get(key_name, '0'))
        client = zk_factory(device['host'], port=int(device['port']), timeout=timeout,
                            password=key, force_udp=bool(device.get('forceUdp', False)),
                            ommit_ping=True, verbose=False)
        connection = client.connect()
        logs = connection.get_attendance()
        records = [{'userId': str(item.user_id),
                    'timestamp': item.timestamp.strftime('%Y-%m-%dT%H:%M:%S'),
                    'terminal': device['name'], 'host': device['host'],
                    'verification': int(item.status), 'punch': int(item.punch)}
                   for item in logs if first_day <= item.timestamp.date() <= last_day]
        return {**result, 'connected': True, 'recordCount': len(records)}, records
    except Exception as error:
        reason = str(error).lower()
        code = 'communication_key' if 'auth' in reason else 'unreachable'
        # Never expose SDK user objects, passwords or a traceback through the API.
        return {**result, 'code': code}, []
    finally:
        if connection is not None:
            try:
                connection.disconnect()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--from-date', required=True)
    parser.add_argument('--through-date', required=True)
    options = parser.parse_args()
    first_day = date.fromisoformat(options.from_date)
    last_day = date.fromisoformat(options.through_date)
    if first_day > last_day or (last_day - first_day).days > 31:
        raise ValueError('invalid_period')
    try:
        from zk import ZK
    except ImportError:
        print(json.dumps({'ok': False, 'code': 'dependency_missing', 'devices': [], 'records': []}))
        return 1
    config = json.loads((ROOT / 'config' / 'pointeuses.json').read_text(encoding='utf-8-sig'))
    timeout = min(10, max(2, config.get('timeoutMs', 3000) / 1000))
    # Keep any library diagnostics away from the JSON output. No user directory
    # or biometric template is exported; only attendance fields leave this process.
    with contextlib.redirect_stdout(io.StringIO()):
        with ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(
                lambda device: read_device(device, first_day, last_day, timeout, ZK), config['devices']))
    devices = [result[0] for result in results]
    response = {'ok': any(device['connected'] for device in devices), 'devices': devices,
                'records': [record for _, records in results for record in records]}
    print(json.dumps(response, ensure_ascii=True))
    return 0 if response['ok'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError):
        print(json.dumps({'ok': False, 'code': 'configuration', 'devices': [], 'records': []}))
        sys.exit(1)
