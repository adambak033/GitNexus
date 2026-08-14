/** Toggled by the WAL-checkpoint driver's start (true) / stop (false). */
export declare const markWalDriverActive: (active: boolean) => void;
/** True while the manual WAL-checkpoint driver is running. @see streamQuery */
export declare const isWalDriverActive: () => boolean;
