// 用法：NODE_OPTIONS=--import=/home/larry/Common/dsh-flash-presets/scripts/ptc-redeclare-fix/register.mjs
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);