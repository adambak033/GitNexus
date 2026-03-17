<?php

require_once 'User.php';
require_once 'Repo.php';

class App {
    /** @var User[] */
    private array $users;

    public function __construct() {
        $this->users = [];
    }

    /**
     * $this->users member access in foreach — iterableName must use $ prefix
     * to match how property_declaration stores the variable in scopeEnv ($users).
     *
     * Uses a typed parameter to ensure the type is in the method's scopeEnv,
     * since class property @var types are stored at file scope (not method scope).
     *
     * @param User[] $users
     */
    public function processMembers(array $users): void {
        foreach ($this->users as $user) {
            $user->save();
        }
    }
}
