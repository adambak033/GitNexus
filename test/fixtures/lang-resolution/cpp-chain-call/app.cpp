#include "service.h"
#include "repo.h"

void processUser() {
    UserService svc;
    svc.getUser().save();
}
