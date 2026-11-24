import { loadCatalog } from '../src/assets/catalog.js';
import { resolveAssetsRoot } from '../src/assets/root.js';

export const root = resolveAssetsRoot();
export const cat = loadCatalog(root);
