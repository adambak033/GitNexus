using NullCheck.Models;

namespace NullCheck.Services
{
    public class App
    {
        public void ProcessInequality(User x)
        {
            if (x != null)
            {
                x.Save();
            }
        }

        public void ProcessIsNotNull(User x)
        {
            if (x is not null)
            {
                x.Save();
            }
        }
    }
}
