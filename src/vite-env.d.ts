/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XRPL_EVM_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite worker imports with ?worker suffix return a Worker constructor
declare module '*?worker' {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}

// Specific worker module declarations
declare module '../../workers/zkProver.worker?worker' {
  const ZkProverWorker: {
    new (): Worker;
  };
  export default ZkProverWorker;
}
